// Actual native drafting store and captured Keep action; only platform, storage and session boundaries are substituted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const req = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(req.resolve("tsx"))("esbuild");

function fixture() {
	let account = "account-A";
	let server = "https://rx.example";
	let document = { id: "letter-A", revision: 1 };
	let paidCalls = 0;
	const storage = new Map();
	const deps = {
		"expo-sqlite/kv-store": {
			__esModule: true,
			default: {
				getItem: async (key) => storage.get(key) ?? null,
				setItem: async (key, value) => void storage.set(key, value),
				removeItem: async (key) => void storage.delete(key),
			},
		},
		"./save": { saveLetter: async () => true },
		"@/api/client": {
			streamClient: {
				coverLetters: {
					draft: async () => {
						paidCalls++;
						return (async function* () {
							yield "REPLACEMENT";
							yield " draft";
						})();
					},
				},
			},
		},
		"@/auth/session": { getAccountScope: () => account, getServer: () => server },
		"@/draft": { useLetterStore: { getState: () => ({ document }) } },
	};
	const code = buildSync({
		entryPoints: [`${root}/apps/mobile/src/features/letters/drafting.ts`],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		external: Object.keys(deps),
		absWorkingDir: root,
	}).outputFiles[0].text;
	const mod = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in deps, `unexpected drafting dependency ${name}`);
			return deps[name];
		},
		mod,
		mod.exports,
	);
	return {
		draft: mod.exports,
		storage,
		paid: () => paidCalls,
		getDocument: () => document,
		setDocument: (value) => (document = value),
		setAccount: (value) => (account = value),
		setServer: (value) => (server = value),
	};
}

const letter = (id = "letter-A") => ({
	id,
	revision: 1,
	content: "Authored content",
	recipientName: "",
	style: { metadata: { page: { locale: "en-US" } } },
	layout: "freeform",
});

// Load write.tsx and expose the internal BodySection so the actual captured onKeep can be invoked.
function loadWriteCaller(f) {
	const jsx = (type, props) => ({ type, props });
	const t = (pieces, ...values) => pieces.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
	const store = (selector) => selector({ document: f.getDocument(), status: "saved" });
	store.getState = () => ({
		document: f.getDocument(),
		update: (recipe) => {
			const current = f.getDocument();
			recipe(current);
		},
	});
	const symbols = new Proxy(
		{ __esModule: true },
		{ get: (object, key) => (key in object ? object[key] : String(key)) },
	);
	const deps = {
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
		react: { useEffect: () => {}, useState: (init) => [typeof init === "function" ? init() : init, () => {}] },
		"@lingui/react/macro": { useLingui: () => ({ t }) },
		"@lingui/core/macro": { t },
		"@/draft": { useLetterStore: store },
		"./drafting": {
			...f.draft,
			useLetterDraftFor: (id) =>
				f.draft.draftForOwner(f.draft.useLetterDrafting.getState(), f.draft.letterDraftOwner(id), { phase: "idle" }),
		},
		"./compose": { useLetterWords: () => null },
		"./length": { countWords: (text) => (text?.trim() ? text.trim().split(/\s+/).length : 0) },
		"@/features/applications/queries": { useApplications: () => ({ data: [] }) },
		"@/ui": { useTheme: () => ({ size: { hit: 44 }, space: {} }), showToast: () => {} },
		"@/ui/keyboard": { useKeyboardScrollSpace: () => 0 },
		"@/features/reminders": {},
		"@reactive-resume/resume/cover-letter": {
			greetingName: () => null,
			coverLetterTextToHtml: (text) => `<p>${text}</p>`,
		},
	};
	const source = `${root}/apps/mobile/src/features/letters/write.tsx`;
	const code = buildSync({
		stdin: {
			contents: `${readFileSync(source, "utf8")}\nexport { BodySection };`,
			sourcefile: source,
			resolveDir: source.slice(0, source.lastIndexOf("/")),
			loader: "tsx",
		},
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		external: ["*"],
		jsx: "automatic",
		absWorkingDir: root,
	}).outputFiles[0].text;
	const mod = { exports: {} };
	new Function("require", "module", "exports", code)((name) => deps[name] ?? symbols, mod, mod.exports);
	return mod.exports;
}

function captureKeep(f, current) {
	const { BodySection } = loadWriteCaller(f);
	const tree = BodySection({ letter: current, application: null, disabled: false });
	let keep;
	const walk = (node) => {
		if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === "object") {
			if (node.props?.onKeep) keep = node.props.onKeep;
			walk(node.props?.children);
		}
	};
	walk(tree);
	assert.equal(typeof keep, "function", "Keep callback not found in rendered body");
	return keep;
}

function seedReady(f, text = "OLD A PRIVATE DRAFT") {
	const current = letter();
	f.setDocument(current);
	f.draft.useLetterDrafting.setState({
		owner: f.draft.letterDraftOwner(current.id),
		draft: { phase: "ready", text, revision: 1, operation: "op-seed" },
	});
	return current;
}

for (const change of ["account", "server", "both"]) {
	test(`captured Keep cannot cross ${change} scope with the same letter id and revision`, () => {
		const f = fixture();
		const keep = captureKeep(f, seedReady(f));
		const before = f.draft.useLetterDrafting.getState();
		if (change !== "server") f.setAccount("account-B");
		if (change !== "account") f.setServer("https://other.example");
		const current = { ...letter(), content: "B authored content" };
		f.setDocument(current);
		keep("OLD A PRIVATE DRAFT");
		assert.equal(current.content, "B authored content");
		assert.equal(f.draft.useLetterDrafting.getState(), before, "stale Keep must not discard another scope's draft");
		assert.equal(f.paid(), 0);
	});
}

test("current Keep works and a discarded callback cannot overwrite its replacement", async () => {
	const f = fixture();
	const current = seedReady(f, "CURRENT DRAFT");
	captureKeep(f, current)("CURRENT DRAFT");
	assert.equal(current.content, "<p>CURRENT DRAFT</p>");
	assert.equal(f.draft.useLetterDrafting.getState().draft.phase, "idle");
	const keep = captureKeep(f, seedReady(f));
	f.draft.discardLetterDraft();
	await f.draft.startLetterDraft();
	const replacement = f.draft.useLetterDrafting.getState().draft;
	keep("OLD A PRIVATE DRAFT");
	assert.equal(f.getDocument().content, "Authored content");
	assert.equal(f.draft.useLetterDrafting.getState().draft, replacement);
	assert.equal(replacement.text, "REPLACEMENT draft");
});
