import assert from "node:assert/strict";
import { test } from "node:test";
import { i18n } from "@lingui/core";
import { load as loadSource, mobileRequire, tag } from "./harness.mjs";
i18n.loadAndActivate({ locale: "en-US", messages: {} });
const { QueryClient } = mobileRequire("@tanstack/react-query");
const load = (path, mocks, timers = {}) =>
	loadSource(path, mocks, { globals: { setTimeout: timers.set, clearTimeout: timers.clear } });
const { prepareRequest } = load("../../../packages/utils/src/deferred-request.ts", {});
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const drain = () => new Promise((resolve) => setImmediate(resolve));
const empty = { answers: [], checklist: [], questions: [], evidence: {}, ticks: {}, message: "" };
const target = { id: "first", question: "Fictional first question", answer: "Original answer", factIds: [] };
const second = { ...target, id: "second", question: "Fictional second question" };

async function harness() {
	const env = {
		account: "alice",
		backend: { ...empty, answers: [target, second] },
		offline: false,
		holdSave: null,
		heldRead: null,
		reads: 0,
		deletions: [],
		notices: [],
	};
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const key = ["career", "workspace", "job", "fixture"];
	const query = {
		queryKey: key.slice(0, -1),
		queryFn: async () => {
			env.reads++;
			if (env.offline) throw new Error("offline");
			if (env.heldRead) {
				const held = env.heldRead;
				env.heldRead = null;
				return held.promise;
			}
			return env.backend;
		},
	};
	await queryClient.fetchQuery({ ...query, queryKey: key });
	const cells = [];
	const cleanups = [];
	const listeners = new Set();
	const timers = new Map();
	let cursor = 0;
	let serial = 0;
	const react = {
		useState: (initial) => {
			const i = cursor++;
			if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
			return [
				cells[i],
				(next) => {
					cells[i] = typeof next === "function" ? next(cells[i]) : next;
				},
			];
		},
		useRef: (initial) => {
			const i = cursor++;
			return (cells[i] ??= { current: initial });
		},
		useCallback: (fn) => fn,
		useLayoutEffect: (run) => run(),
		useEffect: (run) => {
			const i = cursor++;
			if (!(i in cells)) {
				cells[i] = true;
				cleanups.push(run());
			}
		},
	};
	const AppState = {
		currentState: "active",
		addEventListener: (_event, run) => {
			listeners.add(run);
			return { remove: () => listeners.delete(run) };
		},
	};
	const ui = {
		showToast: (notice) => {
			env.notices.push(notice);
			return env.notices.length;
		},
		dismissToast: () => {},
		toastLifetime: (value) => value,
		useTheme: () => ({ space: {} }),
	};
	const session = {
		getAccountScope: () => env.account,
		getServer: () => "fixture",
		useSession: () => ({ server: "fixture", status: "signed-in" }),
	};
	const client = {
		career: {
			deleteWorkspaceAnswer: async (input) => {
				env.deletions.push(input);
				assert.equal(input.applicationId, "job");
				assert.deepEqual(
					input.expected,
					env.backend.answers.find((answer) => answer.id === input.id),
				);
				env.backend = { ...env.backend, answers: env.backend.answers.filter((answer) => answer.id !== input.id) };
				return env.backend;
			},
		},
	};
	const orpc = {
		career: {
			workspace: { queryOptions: () => query, queryKey: () => query.queryKey },
			saveWorkspace: {
				mutationOptions: () => ({
					mutationFn: async (input) => {
						if (env.holdSave) await env.holdSave.promise;
						env.backend = { ...env.backend, answers: input.answers };
						return env.backend;
					},
				}),
			},
		},
	};
	const api = {
		client,
		orpc,
		SessionChangedError: Error,
		prepareRpc: (procedure, input) =>
			prepareRequest((defer) => defer(() => Promise.resolve(procedure(input)).then((value) => Response.json(value)))),
	};
	const queryHooks = {
		useQueryClient: () => queryClient,
		useQuery: () => ({ data: queryClient.getQueryData(key), isPending: false }),
		useMutation: (options) => ({ mutateAsync: (input) => options.mutationFn(input) }),
	};
	const hooks = load("../src/features/workspace/hooks.ts", {
		"@lingui/core/macro": { t: tag },
		"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
		"@orpc/client": { ORPCError: Error },
		"@tanstack/react-query": queryHooks,
		"expo-sqlite/kv-store": {},
		react,
		"react-native": { AppState },
		"@reactive-resume/schema/career": { EMPTY_WORKSPACE: empty },
		"./state": { createDraftStore: () => ({}) },
		"@/api/client": api,
		"@/auth/session": session,
		"@/draft": {},
		"@/features/ai/providers": {},
		"@/ui": ui,
	});
	const undo = load(
		"../src/features/career/undo.ts",
		{
			"@lingui/core/macro": { t: tag },
			"react-native": { AppState },
			"@/auth/session": session,
			"@/ui": ui,
		},
		{
			set: (run) => {
				const id = ++serial;
				timers.set(id, run);
				return id;
			},
			clear: (id) => timers.delete(id),
		},
	);
	const jsx = (type, props) => ({ type, props });
	const apply = load("../src/features/workspace/tabs/apply.tsx", {
		"@lingui/core": { i18n },
		"@lingui/core/macro": {
			ph: (named) => Object.values(named)[0],
			plural: (count, forms) => forms[count === 1 ? "one" : "other"].replace("#", String(count)),
		},
		"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
		"@tanstack/react-query": queryHooks,
		"expo-clipboard": {},
		"expo-crypto": {},
		"expo-router": { useRouter: () => ({}) },
		react,
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"react-native": { View: "View" },
		"@reactive-resume/schema/application-answers": {},
		"@reactive-resume/schema/applications/data": { hasApplicationSubmission: () => false },
		"@reactive-resume/schema/applications/preparation": {},
		"@reactive-resume/schema/career": {},
		"@reactive-resume/utils/string": {},
		"../answer-library": {},
		"../hooks": { ...hooks, useSavedItems: () => ({ data: [], isPending: false }), useFacts: () => ({ data: [] }) },
		"../logic": {},
		"../parts": {},
		"../prepare-review": { PrepareReview: () => null },
		"../preparation": {},
		"../share": {},
		"../shell": { WorkspaceScreen: "WorkspaceScreen" },
		"@/api/client": api,
		"@/auth/session": session,
		"@/features/ai/providers": {},
		"@/features/application-detail/sections": {},
		"@/features/applications/prior-no-response": {},
		"@/features/applications/queries": {},
		"@/features/career/undo": undo,
		"@/features/documents/queries": {},
		"@/routes": {},
		"@/ui": ui,
	});
	const props = { application: { id: "job", company: "Fictional Northwind", activity: [] }, go() {} };
	const entry = apply.ApplyTab().props.children(props);
	const render = () => {
		cursor = 0;
		return entry.type(entry.props);
	};
	const nodes = (node) =>
		!node || typeof node !== "object"
			? []
			: Array.isArray(node)
				? node.flatMap(nodes)
				: [node, ...nodes(node.props?.children)];
	const cards = () => nodes(render()).filter((node) => node.props?.answer && node.props?.onRemove);
	const remove = () => {
		const row = cards().find((card) => card.props.answer.id === "first");
		assert.ok(row);
		row.props.onRemove();
	};
	return {
		env,
		queryClient,
		key,
		timers,
		listeners,
		hooks,
		remove,
		cards,
		background: () => {
			AppState.currentState = "background";
			for (const listener of listeners) listener("background");
		},
		unmount: () => cleanups.forEach((run) => run?.()),
	};
}

test("actual native question removal awaits queued workspace saves, then background sends only one answer synchronously", async () => {
	const h = await harness();
	h.env.holdSave = deferred();
	const write = h.hooks.useWorkspace("job").save({
		answers: [
			{ ...target, answer: "Newer target answer" },
			{ ...second, answer: "Newer independent answer" },
		],
	});
	h.remove();
	h.remove();
	assert.ok(
		h.cards().some((row) => row.props.answer.id === "first"),
		"No removal acknowledgement before preparation",
	);
	assert.equal(h.env.notices.length, 0);
	assert.equal(h.env.deletions.length, 0);
	h.env.holdSave.resolve();
	await write;
	await drain();
	assert.equal(h.env.notices[0].action.label, "Undo");
	h.background();
	assert.equal(h.env.deletions.length, 1, "transport begins within background callback");
	assert.equal(h.env.deletions[0].expected.answer, "Newer target answer");
	await drain();
	assert.equal(h.env.backend.answers[0].answer, "Newer independent answer");
	assert.equal(h.cards().length, 1);
	h.unmount();
	h.queryClient.clear();
});

test("actual native question Undo keeps stale data hidden after a failed read; Retry cannot resurrect external erasure", async () => {
	const h = await harness();
	h.remove();
	await drain();
	h.env.backend = { ...h.env.backend, answers: [second] };
	h.env.offline = true;
	h.env.notices[0].action.onPress();
	await drain();
	assert.equal(
		h.cards().some((card) => card.props.answer.id === "first"),
		false,
	);
	assert.equal(h.env.deletions.length, 0);
	assert.equal(h.env.notices.at(-1).action.label, "Retry");
	h.env.offline = false;
	h.env.notices.at(-1).action.onPress();
	await drain();
	assert.deepEqual(h.queryClient.getQueryData(h.key).answers, [second]);
	assert.equal(
		h.cards().some((card) => card.props.answer.id === "first"),
		false,
	);
	h.unmount();
	h.queryClient.clear();
});

test("native confirmed workspace fetch cancels an older in-flight response before reading post-deletion state", async () => {
	const h = await harness();
	const old = deferred();
	h.env.heldRead = old;
	const previous = h.queryClient
		.fetchQuery({
			queryKey: h.key,
			queryFn: async () => {
				h.env.heldRead = null;
				return old.promise;
			},
		})
		.catch(() => undefined);
	h.env.backend = { ...h.env.backend, answers: [second] };
	const reading = h.hooks.useWorkspace("job").fetchConfirmed();
	await drain();
	old.resolve({ ...empty, answers: [target, second] });
	await previous;
	const confirmed = await reading;
	await drain();
	assert.deepEqual(confirmed.answers, [second]);
	assert.deepEqual(h.queryClient.getQueryData(h.key).answers, [second]);
	h.unmount();
	h.queryClient.clear();
});

test("actual native question unmount during preparation flushes once after its queued save settles", async () => {
	const h = await harness();
	h.env.holdSave = deferred();
	const writing = h.hooks.useWorkspace("job").save({ answers: [target, second] });
	h.remove();
	h.unmount();
	assert.equal(h.env.deletions.length, 0);
	h.env.holdSave.resolve();
	await writing;
	await drain();
	assert.equal(h.env.deletions.length, 1);
	assert.equal(h.env.deletions[0].id, "first");
	assert.deepEqual(h.env.backend.answers, [second]);
	assert.equal(h.timers.size, 0);
	assert.equal(h.listeners.size, 0);
	h.queryClient.clear();
});
