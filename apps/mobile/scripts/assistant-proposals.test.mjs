import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { i18n } from "@lingui/core";
import { esbuild, mobileRequire, run, tag } from "./harness.mjs";

i18n.loadAndActivate({ locale: "en-US", messages: {} });

const { buildSync, transformSync } = esbuild;
const { produce } = mobileRequire("immer");
const evaluate = (code, dependencies) => run(code, dependencies, { setTimeout: () => {} });
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
const agentContracts = evaluate(
	buildSync({
		entryPoints: [new URL("../../../packages/ai/src/tools/agent-tool-contracts.ts", import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
	{},
);
const wordDiffModule = evaluate(
	buildSync({
		entryPoints: [new URL("../../../packages/resume/src/word-diff.ts", import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
	{},
);
const { defaultResumeData } = evaluate(
	buildSync({
		entryPoints: [mobileRequire.resolve("@reactive-resume/schema/resume/default")],
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
	useStore.load = async (content, initialData, aiOperationIds = []) => {
		let document = {
			id: kind,
			name: kind,
			content,
			data: initialData ?? { summary: { content } },
			isLocked: false,
			revision: 1,
			updatedAt: new Date(),
			aiOperationIds,
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
				documentSaves.push({ kind, owner, applications, aiOperationIds: doc.aiOperationIds });
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
const aiUsage = evaluate(
	buildSync({
		entryPoints: [mobileRequire.resolve("@reactive-resume/schema/ai-usage")],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
	{},
);
const dependencies = {
	"@reactive-resume/ai/tools/agent-tool-contracts": agentContracts,
	"@reactive-resume/schema/ai-usage": aiUsage,
	react: { useMemo: (fn) => fn() },
	immer: { produce },
	zustand: {
		create: (initializer) => {
			const store = mobileRequire("zustand/vanilla").createStore(initializer);
			return Object.assign((selector) => selector(store.getState()), store);
		},
	},
	"@lingui/core/macro": {
		ph: (named) => Object.values(named)[0],
		plural: (n, forms) => (n === 1 ? (forms[1] ?? forms.one) : forms.other).replace("#", String(n)),
		t: (parts) => parts.join(""),
	},
	"@lingui/core": { i18n: { number: i18n.number.bind(i18n), locale: "en" } },
	"@reactive-resume/resume/proposals": shared,
	"@reactive-resume/resume/word-diff": wordDiffModule,
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

test("resume accepted AI replacement is its own undo step after rapid typing", () => {
	const current = () => resumeStore.getState();
	const content = () => current().document?.data?.summary?.content;
	current().update(
		(draft) => {
			draft.summary.content = "<p>Owned</p>";
		},
		{ coalesceKey: "summary.content" },
	);
	current().update(
		(draft) => {
			draft.summary.content = "<p>Owned synthetic delivery.</p>";
		},
		{ coalesceKey: "summary.content" },
	);
	current().update(
		(draft) => {
			draft.summary.content = "<p>Led fictional delivery work.</p>";
		},
		{ coalesceKey: "summary.content", newStep: true },
	);
	assert.equal(content(), "<p>Led fictional delivery work.</p>");
	current().undo();
	assert.equal(content(), "<p>Owned synthetic delivery.</p>", "Undo restores the user's line");
	current().redo();
	assert.equal(content(), "<p>Led fictional delivery work.</p>", "Redo restores the AI replacement");

	current().update(
		(draft) => {
			draft.summary.content = "<p>Led fictional delivery work. More</p>";
		},
		{ coalesceKey: "summary.content" },
	);
	current().undo();
	assert.equal(content(), "<p>Led fictional delivery work.</p>", "Later typing is a separate step");
});

for (const kind of ["resume", "letter"]) {
	const open = () =>
		kind === "resume" ? documents.useResumeAssistantDocument("resume") : documents.useLetterAssistantDocument("letter");
	const owner = kind === "resume" ? resumeStore : letterStore;
	const current = () => owner.getState();
	test(`${kind} pairs only applied proposal sources with the accepted edit`, async () => {
		await owner.load("<p>Old</p>", undefined, ["prior-source"]);
		const rewrite = { ...edit("source-rewrite", "<p>Rewritten</p>"), aiOperationIds: ["rewrite-source"] };
		const addition = {
			...edit("source-addition", "<p>Old</p><p>Mentored two designers</p>"),
			aiOperationIds: ["addition-source", "rewrite-source"],
		};
		const stale = { ...edit("source-stale", "<p>Conflict</p>"), aiOperationIds: ["stale-source"] };
		assert.deepEqual(open().accept([rewrite, addition, stale]), { applied: [rewrite, addition], stale: [stale] });
		const expected = ["prior-source", "rewrite-source", "addition-source"];
		assert.deepEqual(current().document.aiOperationIds, expected, "Sources must be paired before any save");
		assert.equal(documentSaves.length, 0);
	});
	test(`${kind} keeps real acceptance identity through refinements, save echoes and explicit Undo/Redo`, async () => {
		const doc = open();
		const rewrite = edit("rewrite", "<p>Rewritten</p>");
		const addition = edit("addition", "<p>Old</p><p>Mentored two designers</p>");
		const conflict = edit("conflict", "<p>Conflicting rewrite</p>");
		assert.deepEqual(doc.accept([rewrite, addition, conflict]), { applied: [rewrite, addition], stale: [conflict] });
		current().update(
			(draft) => {
				if (kind === "resume") draft.summary.content = "<p>Refined</p><p>Refined mentoring</p>";
				else draft.content = "<p>Refined</p><p>Refined mentoring</p>";
			},
			{ newStep: true },
		);
		await current().flush();
		assert.equal(open().stateOf(addition), "accepted");
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

test("native structural acceptance follows actual draft saves, refinements, offscreen Undo and Redo", async () => {
	const data = structuredClone(defaultResumeData);
	data.summary.content = "<p>Old</p>";
	await resumeStore.load(data.summary.content, data);
	const next = structuredClone(data);
	next.basics.headline = "Design lead";
	const proposal = {
		...edit("structural", "Headline: Design lead\n".repeat(1100)),
		target: { sectionId: "resume", field: "data" },
		snapshot: { before: shared.resumeStructureSnapshot(data), after: shared.resumeStructureSnapshot(next) },
	};
	const doc = documents.useResumeAssistantDocument("resume");
	assert.deepEqual(doc.accept([proposal]), { applied: [proposal], stale: [] });
	await resumeStore.getState().flush();
	assert.equal(resumeStore.getState().data.basics.headline, "Design lead");
	assert.deepEqual(documentSaves.at(-1).applications, { structural: "snapshot:structural" });
	resumeStore.getState().update(
		(draft) => {
			draft.basics.headline = "Refined lead";
		},
		{ newStep: true },
	);
	assert.equal(documents.useResumeAssistantDocument("resume").stateOf(proposal), "accepted");
	resumeStore.getState().undo();
	resumeStore.getState().undo();
	await resumeStore.getState().flush();
	assert.equal(resumeStore.getState().data.basics.headline, "");
	assert.deepEqual(documentSaves.at(-1).applications, { structural: false });
	assert.equal(documents.useResumeAssistantDocument("resume").stateOf({ ...proposal, status: "accepted" }), "pending");
	resumeStore.getState().redo();
	await resumeStore.getState().flush();
	assert.equal(resumeStore.getState().data.basics.headline, "Design lead");
	assert.deepEqual(documentSaves.at(-1).applications, { structural: "snapshot:structural" });
	await resumeStore.restart();
	assert.equal(documents.useResumeAssistantDocument("resume").stateOf(proposal), "accepted");
	assert.deepEqual(resumeStore.getState().proposalApplications, { structural: "snapshot:structural" });
});

// Drive the public ChatView through its component tree; only platform/network boundaries are replaced.
test("native chat records real successes and explicit history changes, never refinements, and restores redo", async () => {
	const part = {
		type: "tool-propose_edits",
		toolCallId: "call",
		state: "output-available",
		output: {
			edits: [edit("rewrite", "<p>Rewritten</p>"), edit("conflict", "<p>Conflict</p>")],
			skipped: [],
			tailoredFor: null,
		},
	};
	const message = { id: "message", role: "assistant", parts: [part] };
	let receiptMessage = message;
	const records = [];
	// What the receipts read back returns; TanStack Query resolves a failed refetch with the error and old data.
	let receiptRead = async () => ({ data: { messages: [message] }, isError: false });
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
		useCallback: (fn) => fn,
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
			"@orpc/client": mobileRequire("@orpc/client"),
			"@tanstack/react-query": {
				useQuery: (options) => {
					const data = { messages: [receiptMessage], thread: {}, isReadOnly: false };
					return {
						data: options?.select ? options.select(data) : data,
						isFetchedAfterMount: true,
						refetch: () => receiptRead(),
					};
				},
				useQueryClient: () => ({}),
			},
			"@reactive-resume/utils/http": { isNetworkError: () => false },
			ai: {},
			"@reactive-resume/ai/tools/agent-tool-contracts": evaluate(
				buildSync({
					entryPoints: [new URL("../../../packages/ai/src/tools/agent-tool-contracts.ts", import.meta.url).pathname],
					bundle: true,
					platform: "node",
					format: "cjs",
					write: false,
				}).outputFiles[0].text,
				{},
			),
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
			"./sent": { sentLines: (messages) => messages.map(() => null) },
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
				orpc: {
					agent: { threads: { get: { queryOptions: () => ({ queryKey: ["thread"] }) } } },
					career: { facts: { queryOptions: () => ({ queryKey: ["facts"] }), key: () => ["facts"] } },
				},
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
	assert.deepEqual(documentSaves.at(-1).applications, { rewrite: "<p>Rewritten</p>" });
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
	assert.deepEqual(documentSaves.at(-1).applications, { rewrite: "<p>Rewritten</p>" });
	resumeStore.getState().redo();
	handlers = render();
	handlers.onAccept(message, part, [part.output.edits[0]]);
	assert.equal(records.length, 0, "Chat never dispatches out-of-order acceptance/history writes");
	await resumeStore.getState().flush();
	await resumeStore.remoteUndo(part.output.edits[0].before);
	handlers = render();
	const pending = proposals.toProposals(part, handlers.statuses)[0];
	assert.equal(handlers.stateOf(pending), "pending", "Mounted chat must honor the newer remote Undo");

	// New wording counts only once a fresh read of the receipts shows it; a failed read keeps the draft open.
	const reworded = part.output.edits[1];
	handlers.onReject(message, part, [reworded]);
	handlers = render();
	handlers.onRestore(message, part, [reworded]);
	handlers = render();
	const wording = shared.withEditedText(reworded, "My wording").after;
	const withWording = {
		...message,
		parts: [
			{
				...part,
				output: { ...part.output, edits: [part.output.edits[0], { ...reworded, after: wording, edited: true }] },
			},
		],
	};
	receiptRead = async () => ({ data: { messages: [message] }, isError: true });
	await assert.rejects(handlers.onEdit(message, part, reworded, "My wording"), /couldn't be read back/);
	receiptRead = async () => ({ data: { messages: [message] }, isError: false });
	await assert.rejects(handlers.onEdit(message, part, reworded, "My wording"), /couldn't be read back/);
	receiptRead = async () => {
		receiptMessage = withWording;
		return { data: { messages: [withWording] }, isError: false };
	};
	await handlers.onEdit(message, part, reworded, "My wording");
	assert.deepEqual(
		records.slice(-3),
		Array(3).fill([{ id: "conflict", status: "pending", text: "My wording", after: reworded.after }]),
	);
	handlers = render();
	const reviewed = proposals.toProposals(part, handlers.statuses).find((proposal) => proposal.id === reworded.id);
	assert.equal(reviewed.after, wording, "Undo rejection must retain the wording confirmed by the server");
	handlers.onAccept(message, part, [reviewed]);
	await resumeStore.getState().flush();
	assert.equal(resumeStore.getState().data.summary.content, wording);
	assert.equal(documentSaves.at(-1).applications[reworded.id], wording);
	// A failed read never confirms, even when the receipts it kept already show that wording.
	receiptRead = async () => ({ data: { messages: [withWording] }, isError: true });
	await assert.rejects(handlers.onEdit(message, part, reworded, "My wording"), /couldn't be read back/);
});

test("resume preserves offscreen Undo, failed saves and pending decisions across a fresh draft owner", async () => {
	const open = () => documents.useResumeAssistantDocument("resume");
	const pending = edit("durable", "<p>Rewritten</p>");
	assert.equal(open().accept([pending]).applied.length, 1);
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).applications, { durable: "<p>Rewritten</p>" });
	resumeStore.getState().undo();
	failedSave = true;
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).applications, { durable: false });
	await resumeStore.restart();
	assert.equal(open().stateOf({ ...pending, status: "accepted" }), "pending");
	failedSave = false;
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).applications, { durable: false });
	await resumeStore.getState().close();
	await resumeStore.getState().open("resume");
	assert.equal(open().stateOf({ ...pending, status: "accepted" }), "pending");
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

test("provider Off keeps saved local Accept and Undo actionable with the message's own sources", async () => {
	const element = (type, props, ...children) => ({ type, props: { ...props, children } });
	const react = {
		createElement: element,
		memo: (fn) => fn,
		useState: (x) => [x, () => {}],
		useRef: (x) => ({ current: x }),
	};
	const theme = { colors: {}, radius: {}, space: {}, size: {}, type: {} };
	const { MessageView } = evaluate(
		"const React = require('react');\n" +
			transformSync(readFileSync(new URL("../src/features/assistant/messages.tsx", import.meta.url), "utf8"), {
				loader: "tsx",
				format: "cjs",
				jsx: "transform",
			}).code,
		{
			...dependencies,
			react,
			"react-native": {
				View: "View",
				ActivityIndicator: "ActivityIndicator",
				Pressable: "Pressable",
				TextInput: "TextInput",
			},
			"@lingui/react/macro": {
				Trans: "Trans",
				useLingui: () => ({
					t: tag,
				}),
			},
			"@tanstack/react-query": { useQueryClient: () => ({}) },
			"./chat": { webSources: agentContracts.agentWebSources },
			"./markdown": { AssistantMarkdown: "Markdown" },
			"./page-fit": { ProposalPageFit: () => null },
			"./save-posting": { SavePosting: "SavePosting" },
			"./proposals": proposals,
			"@/api/client": {},
			"@orpc/client": mobileRequire("@orpc/client"),
			"expo-router": { useRouter: () => ({ push: () => assert.fail("Off edit cannot navigate") }) },
			"./handoff": { handToAssistant: () => assert.fail("Off edit cannot hand off text") },
			"@/features/career/fact-categories": { factCategories: [] },
			"@/features/documents/queries": { useDocuments: () => ({ data: [] }) },
			"@/routes": { routes: {} },
			"@/features/ai/report-content": { ReportAiContent: "Report" },
			"@/features/ai/web-access": { WebAccessAttention: "WebAccessAttention" },
			"@/ui": { ...dependencies["@/ui"], Button: "Button", Text: "Text", Icon: "Icon", useTheme: () => theme },
		},
	);
	const proposal = { ...edit("off-edit", "<p>Saved rewrite</p>"), aiOperationIds: ["model-forged-source"] };
	const doc = documents.useResumeAssistantDocument("resume");
	const part = {
		type: "tool-propose_edits",
		toolCallId: "off-call",
		state: "output-available",
		output: { edits: [proposal], skipped: [], tailoredFor: null },
	};
	let currentProposal;
	const render = () => {
		const buttons = [];
		const walk = (node) => {
			if (!node || typeof node !== "object") return;
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			if (typeof node.type === "function") {
				walk(node.type(node.props));
				return;
			}
			if (node.type === "Button") buttons.push(node.props);
			walk(node.props?.children);
		};
		walk(
			element(MessageView, {
				message: {
					id: "off-message",
					role: "assistant",
					metadata: { aiOperationIds: ["saved-assistant-source"] },
					parts: [part],
				},
				streaming: false,
				readOnly: true,
				answerable: true,
				onAnswer: () => assert.fail("Off cannot continue"),
				proposals: {
					statuses: new Map(),
					locked: false,
					forJobCopy: () => false, // A saved general edit on its original document.
					stateOf: (p) => {
						currentProposal = p;
						return doc.stateOf(p);
					},
					onAccept: (_m, _p, chosen) => doc.accept(chosen),
					onReject: () => {},
				},
			}),
		);
		return buttons;
	};
	const accept = render().find((b) => b.label === "Accept");
	assert.deepEqual(currentProposal.aiOperationIds, ["saved-assistant-source"]);
	assert.equal(
		proposals.toProposals(part, new Map())[0].aiOperationIds,
		undefined,
		"Old messages cannot inherit model-forged sources",
	);
	assert.ok(accept);
	assert.equal(accept.disabled, false);
	accept.onPress();
	assert.deepEqual(resumeStore.getState().document.aiOperationIds, ["saved-assistant-source"]);
	await resumeStore.getState().flush();
	assert.deepEqual(documentSaves.at(-1).aiOperationIds, ["saved-assistant-source"]);
	assert.equal(documents.useResumeAssistantDocument("resume").stateOf(currentProposal), "accepted");
	resumeStore.getState().undo();
	assert.deepEqual(resumeStore.getState().document.aiOperationIds, []);
	await resumeStore.getState().flush();
	assert.equal(render().find((b) => b.label === "Accept").disabled, false);
	assert.equal(documents.useResumeAssistantDocument("resume").stateOf(currentProposal), "pending");
});
