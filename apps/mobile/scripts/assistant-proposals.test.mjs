import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, test } from "node:test";

const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const { produce } = mobileRequire("immer");
function evaluate(code, dependencies) {
	const module = { exports: {} };
	new Function("require", "module", "exports", "setTimeout", code)(
		(name) => {
			assert.ok(name in dependencies, `Missing boundary: ${name}`);
			return dependencies[name];
		},
		module,
		module.exports,
		() => {},
	);
	return module.exports;
}
const shared = evaluate(
	buildSync({
		entryPoints: [new URL("../../../packages/resume/src/proposals.ts", import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
	{},
);
let scope = "account";
const toasts = [];
let suppressed = false;
let failedSave = false;
const documentSaves = [];
const { createDraftStore } = evaluate(
	buildSync({
		entryPoints: [new URL("../src/draft/store.ts", import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		external: ["zustand", "immer"],
	}).outputFiles[0].text,
	{ zustand: mobileRequire("zustand"), immer: { produce } },
);
function store(kind) {
	let runtime;
	let adapter;
	let environment;
	let storage = new Map();
	const useStore = (select) => select(useStore.getState());
	useStore.getState = () => {
		const state = runtime.store.getState();
		return { ...state, update: suppressed ? () => {} : state.update };
	};
	useStore.subscribe = (listener) => runtime.store.subscribe(listener);
	useStore.load = async (content) => {
		let document = {
			id: kind,
			name: kind,
			content,
			data: { summary: { content } },
			isLocked: false,
			revision: 1,
			updatedAt: new Date(),
		};
		storage = new Map();
		adapter = {
			kind,
			delay: 800,
			read: async () => document,
			data: (doc) => (kind === "resume" ? doc.data : doc),
			withData: (doc, data) => (kind === "resume" ? { ...doc, data } : data),
			merge: (saved, _submitted, current) => ({ ...current, ...saved, data: current.data, content: current.content }),
			matches: (left, right) =>
				JSON.stringify(kind === "resume" ? left.data : left.content) ===
				JSON.stringify(kind === "resume" ? right.data : right.content),
			version: (doc) => doc.revision,
			parse: (doc) => ({ ...doc, updatedAt: new Date(doc.updatedAt) }),
			save: async (doc, _baseline, _session, _force, owner, applications) => {
				documentSaves.push({ kind, owner, applications });
				if (failedSave) throw new Error("Offline");
				document = { ...doc, revision: doc.revision + 1 };
				return document;
			},
			copy: async () => {},
			isConflict: () => false,
		};
		environment = {
			storage: {
				getItemSync: (key) => storage.get(key) ?? null,
				setItemSync: (key, value) => storage.set(key, value),
				removeItemSync: (key) => storage.delete(key),
				getAllKeysSync: () => [...storage.keys()],
			},
			scope: async () => scope,
			online: () => true,
			focused: () => false,
		};
		runtime = createDraftStore(adapter, environment);
		await runtime.store.getState().open(kind);
	};
	useStore.remoteUndo = async (content) => {
		const current = runtime.store.getState().document;
		const remote = { ...current, revision: current.revision + 1, updatedAt: new Date(current.updatedAt.getTime() + 1) };
		if (kind === "resume") remote.data = { ...current.data, summary: { ...current.data.summary, content } };
		else remote.content = content;
		adapter.read = async () => remote;
		await runtime.refresh();
	};
	useStore.restart = async () => {
		runtime.suspend();
		runtime = createDraftStore(adapter, environment);
		await runtime.store.getState().open(kind);
	};
	useStore.setState = (...args) => runtime.store.setState(...args);
	return useStore;
}
const resumeStore = store("resume");
const letterStore = store("letter");
const dependencies = {
	react: { useMemo: (fn) => fn() },
	immer: { produce },
	zustand: {
		create: (initializer) => {
			const store = mobileRequire("zustand/vanilla").createStore(initializer);
			return Object.assign((selector) => selector(store.getState()), store);
		},
	},
	"@lingui/core/macro": {
		plural: (n, forms) => (n === 1 ? (forms[1] ?? forms.one) : forms.other).replace("#", String(n)),
		t: (parts) => parts.join(""),
	},
	"@reactive-resume/resume/proposals": shared,
	"@/auth/session": { getAccountScope: () => scope },
	"@/draft": { useResumeStore: resumeStore, useLetterStore: letterStore },
	"@/draft/adapters": { letterAdapter: { matches: (document, data) => document.content === data.content } },
	"@/features/applications/queries": { useApplications: () => ({ data: [] }) },
	"@/ui": { showToast: (toast) => toasts.push(toast), dismissToast: () => {} },
};
const load = (name, extra = {}) =>
	evaluate(
		transformSync(readFileSync(new URL(`../src/features/assistant/${name}.ts`, import.meta.url), "utf8"), {
			loader: "ts",
			format: "cjs",
		}).code,
		{ ...dependencies, ...extra },
	);
const proposals = load("proposals");
const documents = load("document", { "./proposals": proposals });
const edit = (id, after) => ({
	id,
	target: { sectionId: "summary", field: "content" },
	location: "Summary",
	before: "<p>Old</p>",
	after,
	why: "Clearer",
	status: "pending",
	source: "assistant",
});
beforeEach(async () => {
	scope = "account";
	suppressed = false;
	failedSave = false;
	documentSaves.length = 0;
	toasts.length = 0;
	await resumeStore.load("<p>Old</p>");
	await letterStore.load("<p>Old</p>");
});

for (const kind of ["resume", "letter"]) {
	const open = () =>
		kind === "resume" ? documents.useResumeAssistantDocument("resume") : documents.useLetterAssistantDocument("letter");
	const owner = kind === "resume" ? resumeStore : letterStore;
	const current = () => owner.getState();
	test(`${kind} keeps real acceptance identity through refinements, save echoes and explicit Undo/Redo`, async () => {
		const doc = open();
		const rewrite = edit("rewrite", "<p>Rewritten</p>");
		const addition = edit("addition", "<p>Old</p><p>Mentored two designers</p>");
		const conflict = edit("conflict", "<p>Conflicting rewrite</p>");
		assert.deepEqual(doc.accept([rewrite, addition, conflict]), { applied: [rewrite, addition], stale: [conflict] });
		assert.match(toasts[0].message, /^2 edits applied · 1 edit couldn't be placed/);
		current().update(
			(draft) => {
				if (kind === "resume") draft.summary.content = "<p>Refined</p><p>Refined mentoring</p>";
				else draft.content = "<p>Refined</p><p>Refined mentoring</p>";
			},
			{ newStep: true },
		);
		await current().flush();
		assert.equal(open().stateOf(addition), "accepted");
		assert.deepEqual(doc.accept([addition]), { applied: [], stale: [] });
		current().undo();
		assert.equal(
			open().stateOf({ ...addition, status: "accepted" }),
			"accepted",
			"Undo refinement retains original acceptance",
		);
		current().undo();
		assert.equal(
			open().stateOf({ ...addition, status: "accepted" }),
			"pending",
			"Undo acceptance explicitly restores pending",
		);
		current().redo();
		assert.equal(open().stateOf({ ...addition, status: "accepted" }), "accepted");
		current().redo();
		assert.equal(open().stateOf(addition), "accepted");
	});
	test(`${kind} refuses a stale document/account, locked draft or suppressed store update without claiming success`, () => {
		const doc = open();
		const rewrite = edit("rewrite", "<p>Rewritten</p>");
		for (const change of [
			() => {
				scope = "another account";
			},
			() => {
				owner.setState({ document: { ...current().document, id: "another document" } });
			},
			() => {
				owner.setState({ locked: true });
			},
			() => {
				suppressed = true;
			},
		]) {
			change();
			assert.deepEqual(doc.accept([rewrite]), { applied: [], stale: [] });
			scope = "account";
			owner.setState({ document: { ...current().document, id: kind }, locked: false });
			suppressed = false;
		}
		assert.deepEqual(toasts, []);
	});
}

// Drive the public ChatView through its component tree; only platform/network boundaries are replaced.
test("native chat records real successes and explicit history changes, never refinements, and restores redo", async () => {
	const part = {
		type: "tool-propose_edits",
		toolCallId: "call",
		state: "output-available",
		output: { edits: [edit("rewrite", "<p>Rewritten</p>"), edit("conflict", "<p>Conflict</p>")], skipped: [] },
	};
	const message = { id: "message", role: "assistant", parts: [part] };
	const records = [];
	const componentHooks = new Map();
	let active;
	let cursor;
	let dirty;
	let effects;
	const slot = () => {
		const index = cursor++;
		return [active, index];
	};
	const element = (type, props, ...children) => ({
		type,
		props: { ...props, ...(children.length ? { children } : {}) },
	});
	const hooks = {
		createElement: element,
		useState: (initial) => {
			const [state, index] = slot();
			if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
			return [
				state[index],
				(next) => {
					const value = typeof next === "function" ? next(state[index]) : next;
					if (!Object.is(value, state[index])) {
						state[index] = value;
						dirty = true;
					}
				},
			];
		},
		useRef: (initial) => hooks.useState(() => ({ current: initial }))[0],
		useMemo: (fn, deps) => {
			const [state, index] = slot();
			if (!state[index] || deps.some((dep, i) => !Object.is(dep, state[index].deps[i])))
				state[index] = { deps, value: fn() };
			return state[index].value;
		},
		useEffect: (fn, deps) => {
			const [state, index] = slot();
			if (!deps || !state[index] || deps.some((dep, i) => !Object.is(dep, state[index][i]))) effects.push(fn);
			state[index] = deps;
		},
		useEffectEvent: (fn) => fn,
	};
	hooks.useLayoutEffect = hooks.useEffect;
	const theme = { colors: {}, radius: {}, space: {} };
	const { ChatView } = evaluate(
		"const React = require('react');\n" +
			transformSync(readFileSync(new URL("../src/features/assistant/chat-view.tsx", import.meta.url), "utf8"), {
				loader: "tsx",
				format: "cjs",
				jsx: "transform",
			}).code,
		{
			...dependencies,
			react: hooks,
			"@legendapp/list/react-native": { LegendList: "LegendList" },
			"@lingui/react/macro": { Trans: "Trans", useLingui: () => ({ t: (parts) => parts.join("") }) },
			"@orpc/client": { ORPCError: class extends Error {} },
			"@tanstack/react-query": {
				useQuery: () => ({ data: { messages: [message], thread: {}, isReadOnly: false }, isFetchedAfterMount: true }),
				useQueryClient: () => ({}),
			},
			ai: {},
			"expo-clipboard": {},
			"expo-document-picker": {},
			"expo-file-system": {},
			"react-native": { View: "View", AppState: { addEventListener: () => ({ remove() {} }) } },
			"react-native-keyboard-controller": { KeyboardAvoidingView: "KeyboardAvoidingView" },
			"./chat": {
				refreshThreads() {},
				useAssistantChat: () => ({
					messages: [message],
					status: "ready",
					instance: { status: "ready", stop: async () => {} },
				}),
			},
			"./messages": { MessageView: "MessageView" },
			"./proposals": proposals,
			"./recovery": load("recovery"),
			"./tool-approvals": {},
			"@/api/client": {
				client: {
					agent: {
						messages: {
							setEditStatus: async (input) => {
								records.push(input.edits);
							},
						},
					},
				},
				orpc: { agent: { threads: { get: { queryOptions: () => ({ queryKey: ["thread"] }) } } } },
			},
			"@/auth/session": { ...dependencies["@/auth/session"], useSession: () => ({ status: "signed-in" }) },
			"@/ui": { ...dependencies["@/ui"], useTheme: () => theme },
			"@/ui/use-pull-refresh": { usePullRefresh: () => ({}) },
		},
	);
	const render = () => {
		let list;
		let passes = 0;
		do {
			dirty = false;
			effects = [];
			const visit = (node) => {
				if (!node || typeof node !== "object") return;
				if (Array.isArray(node)) {
					node.forEach(visit);
					return;
				}
				if (
					typeof node.type === "function" &&
					["ChatView", "ScopedChatView", "Session", "Conversation"].includes(node.type.name)
				) {
					if (!componentHooks.has(node.type)) componentHooks.set(node.type, []);
					active = componentHooks.get(node.type);
					cursor = 0;
					visit(node.type(node.props));
				} else {
					if (node.type === "LegendList") list = node;
					visit(node.props?.children);
				}
			};
			visit(
				element(ChatView, {
					threadId: "thread",
					context: { document: true, posting: true },
					document: documents.useResumeAssistantDocument("resume"),
					connection: "Local",
					privacy: "",
					placeholder: "",
					assistantName: "Assistant",
				}),
			);
			for (const effect of effects) effect();
			assert.ok(++passes < 10, "Chat must settle");
		} while (dirty);
		assert.ok(list, "Mounted chat exposes its message list");
		return list.props.extraData.handlers;
	};
	let handlers = render();
	handlers.onAccept(message, part, part.output.edits);
	handlers = render();
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).applications, { rewrite: true });
	assert.deepEqual(records, []);
	resumeStore.getState().update(
		(draft) => {
			draft.summary.content = "<p>Manual refinement</p>";
		},
		{ newStep: true },
	);
	handlers = render();
	assert.equal(records.length, 0, "Chat must not race the draft save");
	assert.equal(handlers.stateOf(part.output.edits[0]), "accepted");
	resumeStore.getState().undo();
	render();
	assert.equal(records.length, 0, "Undoing a refinement retains acceptance");
	resumeStore.getState().undo();
	render();
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).applications, { rewrite: false });
	resumeStore.getState().redo();
	render();
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).applications, { rewrite: true });
	resumeStore.getState().redo();
	handlers = render();
	handlers.onAccept(message, part, [part.output.edits[0]]);
	assert.equal(records.length, 0, "Chat never dispatches out-of-order acceptance/history writes");
	await resumeStore.getState().flush();
	await resumeStore.remoteUndo(part.output.edits[0].before);
	handlers = render();
	const pending = proposals.toProposals(part, handlers.statuses)[0];
	assert.equal(handlers.stateOf(pending), "pending", "Mounted chat must honor the newer remote Undo");
	await Promise.resolve();
});

for (const kind of ["resume", "letter"]) {
	test(`${kind} preserves offscreen Undo, failed saves and pending decisions across a fresh draft owner`, async () => {
		const owner = kind === "resume" ? resumeStore : letterStore;
		const open = () =>
			kind === "resume" ? documents.useResumeAssistantDocument(kind) : documents.useLetterAssistantDocument(kind);
		const pending = edit("durable", "<p>Rewritten</p>");
		assert.equal(open().accept([pending]).applied.length, 1);
		await owner.getState().flush();
		assert.deepEqual(documentSaves.at(-1).applications, { durable: true });
		owner.getState().undo();
		failedSave = true;
		await owner.getState().flush();
		assert.deepEqual(documentSaves.at(-1).applications, { durable: false });
		await owner.restart();
		assert.equal(open().stateOf({ ...pending, status: "accepted" }), "pending");
		failedSave = false;
		await owner.getState().flush();
		assert.deepEqual(documentSaves.at(-1).applications, { durable: false });
		await owner.getState().close();
		await owner.getState().open(kind);
		assert.equal(open().stateOf({ ...pending, status: "accepted" }), "pending");
	});
	test(`${kind} rejects a quote-normalized no-op without recording acceptance`, () => {
		const owner = kind === "resume" ? resumeStore : letterStore;
		const open = () =>
			kind === "resume" ? documents.useResumeAssistantDocument(kind) : documents.useLetterAssistantDocument(kind);
		const pending = {
			...edit("noop", `<p>They've said "yes".</p>`),
			before: "<p>They&#39;ve said &quot;yes&quot;.</p>",
		};
		owner.getState().update(
			(draft) => {
				if (kind === "resume") draft.summary.content = pending.after;
				else draft.content = pending.after;
			},
			{ newStep: true },
		);
		assert.equal(open().accept([pending]).applied.length, 0);
		assert.equal(owner.getState().proposalApplications[pending.id], undefined);
		assert.equal(open().stateOf(pending), "stale");
	});
}

test("both native API adapters include unsynchronized proposal decisions in their document save", async () => {
	const requests = [];
	const { resumeAdapter, letterAdapter } = evaluate(
		buildSync({
			entryPoints: [new URL("../src/draft/adapters.ts", import.meta.url).pathname],
			bundle: true,
			platform: "node",
			format: "cjs",
			write: false,
			external: ["@/api/client", "@lingui/core/macro", "@orpc/client"],
		}).outputFiles[0].text,
		{
			"@/api/client": {
				client: {
					resume: {
						update: async (input, context) => {
							requests.push({ input, context });
							return {};
						},
					},
					coverLetters: {
						update: async (input, context) => {
							requests.push({ input, context });
							return {};
						},
					},
				},
			},
			"@lingui/core/macro": dependencies["@lingui/core/macro"],
			"@orpc/client": { ORPCError: class extends Error {} },
		},
	);
	const document = {
		id: "document",
		data: {},
		revision: 3,
		updatedAt: new Date(),
		senderLinked: true,
		style: { basics: {}, metadata: {} },
	};
	for (const adapter of [resumeAdapter, letterAdapter]) {
		await adapter.save(document, document, "session", false, "account", { edit: false });
		assert.deepEqual(requests.at(-1).input.proposalApplications, { edit: false });
		assert.deepEqual(requests.at(-1).context, { context: { scope: "account" } });
	}
});

test("closed native chat never republishes old pending marks after an external receipt rebase", async () => {
	const addition = edit("addition", "<p>Old</p><p>Documented handoffs</p>");
	proposals.publishProposals("resume", [addition]);
	const marked = () => proposals.useMarkedResumeData("resume", resumeStore.getState().data);
	assert.equal(marked().pending, 1);
	documents.useResumeAssistantDocument("resume").accept([addition]);
	await resumeStore.getState().flush();
	assert.equal(marked().pending, 0);
	await resumeStore.remoteUndo(addition.before);
	assert.equal(marked().pending, 0, "Old marks require authoritative receipt refresh after rebasing");
	proposals.publishProposals("resume", [addition]);
	assert.equal(marked().pending, 1);
});
