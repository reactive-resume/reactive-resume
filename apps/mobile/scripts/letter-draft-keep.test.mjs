// Actual native drafting store and captured Keep action; only platform, storage and session boundaries are substituted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const req = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(req.resolve("tsx"))("esbuild");

function fixture(options = {}) {
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
					draft: async (input) => {
						assert.equal(input.includeProvenance, true);
						paidCalls++;
						return (async function* () {
							yield { aiOperationId: `server-operation-${paidCalls}` };
							yield "REPLACEMENT";
							yield " draft";
							options.onText?.();
							await options.hold;
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
		update: (recipe, options) => {
			f.lastUpdate = options;
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
		draft: { phase: "ready", text, revision: 1, operation: "op-seed", aiOperationIds: ["server-seed"], versions: [] },
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
	captureKeep(f, current)("CURRENT DRAFT", ["server-seed"]);
	assert.deepEqual(current.aiOperationIds, ["server-seed"]);
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

test("native per-version sources survive revision and account-bound recovery without replacing the Keep nonce", async () => {
	const f = fixture();
	const current = seedReady(f);
	await f.draft.startLetterDraft("shorter", "OLD A PRIVATE DRAFT", ["server-seed"]);
	const ready = f.draft.useLetterDrafting.getState().draft;
	assert.deepEqual(ready.aiOperationIds, ["server-seed", "server-operation-1"]);
	assert.deepEqual(ready.versions, [{ text: "OLD A PRIVATE DRAFT", aiOperationIds: ["server-seed"] }]);
	assert.notEqual(ready.operation, "server-operation-1");
	const stored = JSON.parse(f.storage.get(f.draft.letterDraftOwner(current.id)));
	assert.deepEqual(stored.versions, ["OLD A PRIVATE DRAFT"], "older bundles retain earlier draft text");
	assert.deepEqual(stored.versionAiOperationIds, [["server-seed"]]);
	f.draft.useLetterDrafting.setState({ draft: { phase: "idle" } });
	await f.draft.restoreLetterDraft(current.id);
	const restored = f.draft.useLetterDrafting.getState().draft;
	assert.deepEqual(restored.aiOperationIds, ready.aiOperationIds);
	assert.deepEqual(restored.versions, ready.versions);
	assert.equal(f.paid(), 1);
	captureKeep(f, current)(restored.text, restored.aiOperationIds);
	assert.deepEqual(current.aiOperationIds, ["server-seed", "server-operation-1"]);
	assert.equal(current.content, "<p>REPLACEMENT draft</p>");
});

test("native Stop retains partial request lineage through recovery without another provider call", async () => {
	let release;
	let arrived;
	const hold = new Promise((resolve) => {
		release = resolve;
	});
	const text = new Promise((resolve) => {
		arrived = resolve;
	});
	const f = fixture({ hold, onText: arrived });
	const current = seedReady(f);
	const pending = f.draft.startLetterDraft("personal", "OLD A PRIVATE DRAFT", ["server-seed"]);
	await text;
	f.draft.stopLetterDraftKeepingText();
	const stopped = f.draft.useLetterDrafting.getState().draft;
	assert.equal(stopped.stopped, true);
	assert.deepEqual(stopped.aiOperationIds, ["server-seed", "server-operation-1"]);
	release();
	await pending;
	f.draft.useLetterDrafting.setState({ draft: { phase: "idle" } });
	await f.draft.restoreLetterDraft(current.id);
	assert.deepEqual(f.draft.useLetterDrafting.getState().draft.aiOperationIds, stopped.aiOperationIds);
	assert.equal(f.paid(), 1);
});

test("letter body wires the shared Improve history step and owned posting into its draft store", () => {
	const f = fixture();
	const current = letter();
	current.aiOperationIds = ["original-source"];
	f.setDocument(current);
	f.draft.useLetterDrafting.setState({ owner: f.draft.letterDraftOwner(current.id), draft: { phase: "idle" } });
	const { BodySection } = loadWriteCaller(f);
	const tree = BodySection({ letter: current, application: { id: "owned-application" }, disabled: false });
	let field;
	const walk = (node) => {
		if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === "object") {
			if (node.props?.label === "Letter body") field = node;
			walk(node.props?.children);
		}
	};
	walk(tree);
	assert.ok(field);
	assert.equal(field.props.applicationId, "owned-application");
	field.props.onChange("<p>Reviewed paragraph</p>", { newStep: true, aiOperationIds: ["reviewed-improve"] });
	assert.equal(current.content, "<p>Reviewed paragraph</p>");
	assert.deepEqual(current.aiOperationIds, ["original-source", "reviewed-improve"]);
	assert.equal(current.aiUsage, null);
	assert.deepEqual(f.lastUpdate, { coalesceKey: "content", newStep: true, aiOperationIds: ["reviewed-improve"] });
});
