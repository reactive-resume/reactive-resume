// Real native component/hooks, auth client and private HTTP; rasterization/files/share are platform boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const rootRequire = createRequire(new URL("../../../package.json", import.meta.url));
const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const React = rootRequire("react");
const { act } = React;
const { Window } = await import(rootRequire.resolve("happy-dom"));
const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = rootRequire("react-dom/client");

function bundle(relative) {
	const module = { exports: {} };
	new Function(
		"module",
		"exports",
		buildSync({
			entryPoints: [fileURLToPath(new URL(relative, import.meta.url))],
			bundle: true,
			platform: "node",
			format: "cjs",
			write: false,
		}).outputFiles[0].text,
	)(module, module.exports);
	return module.exports;
}
function load(relative, dependencies) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8"), {
		loader: relative.endsWith("tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
		target: "es2022",
	}).code;
	new Function("React", "require", "module", "exports", code)(
		React,
		(name) => dependencies[name] ?? mobileRequire(name),
		module,
		module.exports,
	);
	return module.exports;
}
const http = bundle("../../../packages/utils/src/http.ts");
const fileUtils = bundle("../../../packages/utils/src/file.ts");
const tag = (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
let scope = "owner";
let token = "owner-token";
let identity = 1;
let session = { status: "signed-in", server: "" };
const identityListeners = new Set();
const sessionListeners = new Set();
let refresh = async () => null;
const credentials = () => ({
	scope,
	account: identity,
	server: session.server,
	accessToken: scope === "owner" ? token : "other-token",
});
const auth = {
	getAccountScope: () => scope,
	getSession: () => session,
	getCredentials: async () => credentials(),
	recoverFromUnauthorized: (...args) => refresh(...args),
	rejectCredentials: async () => {},
	subscribeIdentity(listener) {
		identityListeners.add(listener);
		return () => identityListeners.delete(listener);
	},
	useSession: () =>
		React.useSyncExternalStore(
			(listener) => {
				sessionListeners.add(listener);
				return () => sessionListeners.delete(listener);
			},
			() => session,
		),
};
function changeAccount(next) {
	scope = next;
	identity++;
	session = { ...session };
	for (const listener of identityListeners) listener();
	for (const listener of sessionListeners) listener();
}
// Native parsing/rasterization is a platform boundary here; HTTP and sharing must preserve these exact bytes.
const pdf = Buffer.from("%PDF-1.4\nFictional native boundary fixture\n%%EOF\n");
const requests = [];
let foreignReads = 0;
const foreign = createServer((_request, response) => {
	foreignReads++;
	response.end("foreign");
});
await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
const foreignUrl = `http://127.0.0.1:${foreign.address().port}`;
let delayed;
const server = createServer(async (request, response) => {
	requests.push({ path: request.url, authorization: request.headers.authorization });
	if (request.url === "/api/uploads/redirect.pdf") {
		response.writeHead(302, { location: `${foreignUrl}/stolen` });
		response.end();
		return;
	}
	if (request.url === "/api/uploads/refresh.pdf" && request.headers.authorization === "Bearer old-token") {
		response.writeHead(401);
		response.end("UNAUTHORIZED");
		return;
	}
	if (!["Bearer owner-token", "Bearer new-token"].includes(request.headers.authorization)) {
		response.writeHead(404);
		response.end();
		return;
	}
	if (request.url === "/api/uploads/delayed.pdf") {
		delayed.observed.resolve();
		await delayed.release.promise;
	}
	response.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "private, no-store" });
	response.end(pdf);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
session.server = `http://127.0.0.1:${server.address().port}`;
const { privateUpload } = load("api/client.ts", {
	"expo/fetch": { fetch },
	"@/auth/session": auth,
	"@reactive-resume/utils/http": http,
	"./ai-consent": { authorizeAiRequest: async () => ({}) },
});
after(async () => {
	await Promise.all(
		[server, foreign].map(
			(value) =>
				new Promise((resolve) => {
					value.close(resolve);
					value.closeAllConnections();
				}),
		),
	);
	await window.happyDOM.abort();
});

test("private uploads authenticate only original-origin upload URLs, reject redirects, refresh within account, and fence late responses", async () => {
	scope = "owner";
	token = "owner-token";
	const signal = new AbortController().signal;
	assert.deepEqual(
		await http.readResponseBytes(await privateUpload("/api/uploads/owner.pdf", signal, scope), 10 * 1024 * 1024),
		new Uint8Array(pdf),
	);
	assert.equal(requests.at(-1).authorization, "Bearer owner-token");
	const before = requests.length;
	for (const url of [
		`${foreignUrl}/api/uploads/owner.pdf`,
		"/api/auth/sign-out",
		"https://user:pass@localhost/api/uploads/a.pdf",
	])
		await assert.rejects(privateUpload(url, signal, scope), /Invalid private upload URL/);
	assert.equal(requests.length, before);
	await assert.rejects(privateUpload("/api/uploads/redirect.pdf", signal, scope));
	assert.equal(foreignReads, 0, "a redirect must never transmit credentials to its target");
	token = "old-token";
	refresh = async () => ({ ...credentials(), accessToken: "new-token" });
	assert.deepEqual(
		await http.readResponseBytes(await privateUpload("/api/uploads/refresh.pdf", signal, scope), pdf.length),
		new Uint8Array(pdf),
	);
	assert.deepEqual(
		requests.slice(-2).map((value) => value.authorization),
		["Bearer old-token", "Bearer new-token"],
	);
	token = "owner-token";
	refresh = async () => null;
	delayed = { observed: Promise.withResolvers(), release: Promise.withResolvers() };
	const pending = privateUpload("/api/uploads/delayed.pdf", signal, "owner");
	await delayed.observed.promise;
	scope = "other";
	delayed.release.resolve();
	await assert.rejects(pending, { name: "SessionChangedError" });
	scope = "owner";
});

let opened;
let rendered;
let closed;
let opening;
let parseFailure = false;
let shareAvailability;
const shared = [];
const files = [];
let previewReads = 0;
class Directory {
	constructor(_parent, name) {
		this.name = name;
		this.uri = `file:///cache/${name}`;
	}
	create() {}
}
class File {
	constructor(directory, name) {
		this.uri = `${directory.uri}/${name}`;
		this.name = name;
		this.exists = false;
		files.push(this);
	}
	async write(bytes) {
		this.bytes = Uint8Array.from(bytes);
		this.exists = true;
	}
	delete() {
		this.exists = false;
	}
}
const fs = { File, Directory, Paths: { cache: { list: () => [] } } };
const sharing = {
	isAvailableAsync: async () => {
		if (shareAvailability) {
			shareAvailability.observed.resolve();
			await shareAvailability.release.promise;
		}
		return true;
	},
	shareAsync: async (uri) => shared.push(uri),
};
const model = load("features/share/model.ts", {});
const exports = load("features/share/files.ts", {
	"expo-file-system": fs,
	"expo-print": {},
	"expo-sharing": sharing,
	"@lingui/core/macro": { t: tag },
	"@reactive-resume/resume/export-sections": {},
	"./letter": {},
	"./messages": {},
	"./model": model,
	"@/api/client": {},
	"@/auth/session": auth,
	"@/preview/pipeline": {},
	"@/ui": {},
});
const { AttachmentPreview } = load("features/application-detail/attachment-preview.tsx", {
	react: React,
	"react-native": {
		View: ({ children }) => React.createElement("div", null, children),
		ActivityIndicator: () => React.createElement("span", null, "Loading"),
	},
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-US" } }) },
	"expo-file-system": fs,
	"expo-image": {
		Image: (props) => React.createElement("img", { src: props.source.uri, alt: props.accessibilityLabel }),
	},
	"@reactive-resume/utils/file": fileUtils,
	"@reactive-resume/utils/http": http,
	"../../../modules/pdf-pages": {
		pdfPages: {
			async open(bytes) {
				assert.deepEqual(bytes, new Uint8Array(pdf));
				opened.resolve();
				if (parseFailure) throw new Error("Unsupported PDF");
				if (opening) await opening.promise;
				return {
					id: "private-document",
					pages: [
						{ width: 300, height: 400 },
						{ width: 300, height: 400 },
					],
				};
			},
			async rasterize(_id, pages) {
				const result = pages.map((index) => ({
					index,
					uri: `file:///private/page-${index}.png`,
					width: 300,
					height: 400,
				}));
				rendered.resolve(pages);
				return result;
			},
			async close(id) {
				closed.resolve(id);
			},
		},
	},
	"./attachment": load("features/application-detail/attachment.ts", {}),
	"@/api/client": {
		privateUpload(...args) {
			previewReads++;
			return privateUpload(...args);
		},
	},
	"@/auth/session": auth,
	"@/features/share/files": exports,
	"@/features/share/model": model,
	"@/ui": {
		useTheme: () => ({ colors: {}, space: {} }),
		showToast() {},
		Text: ({ children }) => React.createElement("p", null, children),
		ListRow: (props) => React.createElement("div", null, props.title, props.subtitle, props.trailing),
		Button: (props) =>
			React.createElement("button", { onClick: props.onPress, disabled: props.disabled || props.loading }, props.label),
	},
});
async function mount({ failParse = false, openGate } = {}) {
	scope = "owner";
	token = "owner-token";
	session = { ...session };
	opened = Promise.withResolvers();
	rendered = Promise.withResolvers();
	closed = Promise.withResolvers();
	opening = openGate;
	parseFailure = failParse;
	shareAvailability = undefined;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () =>
		root.render(
			React.createElement(AttachmentPreview, { url: "/api/uploads/owner.pdf", name: "Fictional.pdf", trailing: null }),
		),
	);
	return {
		container,
		async close() {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

test("native preview shows only page one with fetched size and shares the exact private PDF", async () => {
	const view = await mount();
	try {
		await act(async () => {
			assert.deepEqual(await rendered.promise, [0]);
		});
		assert.equal(view.container.querySelectorAll("img").length, 1);
		assert.equal(view.container.querySelector("img").getAttribute("src"), "file:///private/page-0.png");
		assert.match(view.container.textContent, /1 kB/);
		await act(async () => view.container.querySelector("button").click());
		assert.deepEqual(files.at(-1).bytes, new Uint8Array(pdf));
		assert.equal(shared.at(-1), files.at(-1).uri);
	} finally {
		await view.close();
	}
	assert.equal(await closed.promise, "private-document");
});

test("native parse errors keep actual size and file access, and a late open after unmount is closed", async () => {
	const view = await mount({ failParse: true });
	try {
		await act(async () => {
			await opened.promise;
		});
		assert.equal(view.container.querySelectorAll("img").length, 0);
		assert.match(view.container.textContent, /1 kB/);
		assert.match(view.container.textContent, /Couldn't read that file/);
		assert.match(view.container.textContent, /Save or share file/);
		parseFailure = false;
		await act(async () =>
			[...view.container.querySelectorAll("button")].find((button) => button.textContent === "Try again").click(),
		);
		await act(async () => {
			await rendered.promise;
		});
		assert.equal(view.container.querySelectorAll("img").length, 1);
	} finally {
		await view.close();
		parseFailure = false;
	}
	const gate = Promise.withResolvers();
	const late = await mount({ openGate: gate });
	await act(async () => {
		await opened.promise;
	});
	await late.close();
	gate.resolve();
	assert.equal(await closed.promise, "private-document");
});

test("same-account reauthentication releases the prior preview and reloads instead of leaving an empty row", async () => {
	const view = await mount();
	try {
		await act(async () => {
			await rendered.promise;
		});
		rendered = Promise.withResolvers();
		const before = previewReads;
		await act(async () => changeAccount("owner"));
		assert.equal(previewReads, before + 1, "a new session must reload its canceled private preview");
		await act(async () => {
			await rendered.promise;
		});
		assert.equal(view.container.querySelector("img").getAttribute("src"), "file:///private/page-0.png");
	} finally {
		await view.close();
	}
});

test("an account change while sharing availability is pending cannot share or retain an old private copy", async () => {
	const view = await mount();
	try {
		await act(async () => {
			await rendered.promise;
		});
		shareAvailability = { observed: Promise.withResolvers(), release: Promise.withResolvers() };
		const before = shared.length;
		await act(async () => view.container.querySelector("button").click());
		await shareAvailability.observed.promise;
		const file = files.at(-1);
		await act(async () => {
			changeAccount("other");
			shareAvailability.release.resolve();
		});
		assert.equal(shared.length, before);
		assert.equal(file.exists, false);
		assert.equal(view.container.querySelectorAll("img").length, 0);
	} finally {
		shareAvailability = undefined;
		await view.close();
	}
});
