import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { load as loadSource, mobileRequire, tag } from "./harness.mjs";
const { MutationObserver, QueryClient } = mobileRequire("@tanstack/react-query");
const zod = createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod");
const load = (file, mocks, timers = {}) =>
	loadSource(file, mocks, { globals: { setTimeout: timers.set, clearTimeout: timers.clear } });
const { prepareRequest } = load("../../../packages/utils/src/deferred-request.ts", {});
const data = load("../../../packages/schema/src/applications/data.ts", {
	zod,
	"@reactive-resume/utils/timezone": load("../../../packages/utils/src/timezone.ts", { zod }),
});
const schemaLanes = load("../../../packages/schema/src/applications/lanes.ts", { zod, "./data": data });
const tracker = load("../../../packages/schema/src/applications/stage-baselines.ts", { "./data": data });
const lanes = load("../src/features/applications/lanes.ts", {
	"@reactive-resume/schema/applications/lanes": schemaLanes,
	"./stages": { getStageLabel: (value) => value },
});
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const drain = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await drain();
	}
	assert.fail("Expected lifecycle did not settle");
}
function harness() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const initial = { id: "fictional-job", status: "applied", laneId: null, closedReason: null, activity: [] };
	const env = {
		account: "alice",
		row: initial,
		metadata: true,
		laneGate: null,
		notices: [],
		sent: [],
		reminders: [],
		reads: 0,
		sequence: 0,
	};
	const getServer = () => "fixture";
	const auth = {
		getServer,
		getAccountScope: () => env.account,
		useSession: () => ({ status: "signed-in", server: getServer() }),
	};
	const pipeline = { revision: 0, lanes: schemaLanes.createDefaultApplicationLanes() };
	const metadataKey = ["lanes", "fixture", "alice"];
	const query = (name, read) => ({
		key: () => [name],
		queryOptions: (options) => ({ queryKey: [name, ...(options?.input?.id ? [options.input.id] : [])], queryFn: read }),
	});
	const mutate = (name) => ({
		mutationOptions: () => ({ mutationKey: [["applications", name], { type: "mutation" }] }),
	});
	const orpc = {
		applications: {
			key: () => ["applications"],
			listSummary: query("applications", async () => {
				env.reads++;
				return [env.row];
			}),
			getById: query("detail", async () => env.row),
			...Object.fromEntries(
				["create", "update", "trash", "bulkUpdate", "bulkTrash", "import", "logFollowUp"].map((name) => [
					name,
					mutate(name),
				]),
			),
		},
		documents: { key: () => ["documents"] },
		career: { key: () => ["career"] },
		agent: { key: () => ["agent"] },
	};
	const saved = (status, laneId = null) => {
		const entry = {
			id: `stage-${++env.sequence}`,
			type: "stage",
			stage: status,
			at: new Date(),
			writeSequence: env.sequence,
		};
		env.row = {
			...env.row,
			status,
			laneId,
			closedReason: status === "closed" ? "withdrew" : null,
			activity: [...env.row.activity, entry],
		};
		return { id: env.row.id, status, laneId, closedReason: env.row.closedReason, stageEntryId: entry.id };
	};
	const rpc = {
		applications: {
			update: async (input, options) => {
				assert.equal(options.context.scope, env.account);
				saved(input.status, input.laneId);
				return env.row;
			},
			bulkUpdate: async (input, options) => {
				if (options.context.scope !== env.account) throw new Error("Account changed");
				const response = await options.context.defer(async () => {
					assert.equal(options.context.scope, env.account);
					env.sent.push(input);
					const expected = input.expectedStages[0];
					if (expected.status !== env.row.status || expected.stageEntryId !== data.latestStageEntryId(env.row.activity))
						return Response.json({ updated: 0, stages: [] });
					const lane = pipeline.lanes.find((item) => item.id === input.laneId);
					return Response.json({ updated: 1, stages: [saved(lane?.category ?? input.status, lane?.id ?? null)] });
				});
				return response.json();
			},
		},
	};
	const api = {
		orpc,
		client: rpc,
		SessionChangedError: Error,
		prepareRpc: (procedure, input) => {
			const scope = env.account;
			return prepareRequest((defer) => procedure(input, { context: { scope, defer } }));
		},
	};
	const laneQueries = {
		applicationLanesQueryOptions: () => ({
			queryKey: metadataKey,
			queryFn: async () => {
				if (env.laneGate) await env.laneGate.promise;
				return { supported: env.metadata, pipeline };
			},
		}),
		useApplicationLanes: () => ({ ...pipeline, supported: true }),
	};
	const common = {
		"@lingui/core/macro": { t: tag, plural: (n, forms) => forms[n === 1 ? "one" : "other"].replace("#", String(n)) },
		"@/api/client": api,
		"@/auth/session": auth,
		"@/ui": {
			showToast: (notice) => {
				env.notices.push(notice);
				return env.notices.length;
			},
		},
		"./lanes": lanes,
		"./lane-queries": laneQueries,
		react: { useCallback: (fn) => fn, useRef: (value) => ({ current: value }), useEffect() {}, useMemo: (fn) => fn() },
		"@tanstack/react-query": {
			useQueryClient: () => client,
			useMutation: (options) => ({ mutateAsync: (input) => new MutationObserver(client, options).mutate(input) }),
		},
	};
	const queries = load("../src/features/applications/queries.ts", {
		...common,
		"@/features/reminders": {
			syncReminders: async (id, targets) => {
				assert.deepEqual(targets, []);
				env.reminders.push(id);
			},
		},
	});
	const listKey = queries.applicationsListQueryKey();
	client.setQueryData(listKey, [initial]);
	client.setQueryData(queries.applicationDetailQueryKey(initial.id), initial);
	client.setQueryData(["documents"], ["fictional"]);
	const listeners = new Set();
	const timers = new Map();
	let serial = 0;
	const AppState = {
		currentState: "active",
		addEventListener: (_event, fn) => {
			listeners.add(fn);
			return { remove: () => listeners.delete(fn) };
		},
	};
	const undo = load(
		"../src/features/career/undo.ts",
		{
			...common,
			"react-native": { AppState },
			"@/ui": { ...common["@/ui"], dismissToast() {}, toastLifetime: (value) => value },
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
	const actions = load("../src/features/applications/stage-actions.ts", {
		...common,
		"./queries": queries,
		"./stages": {},
		"@reactive-resume/schema/applications/next-step": {},
		"@reactive-resume/schema/applications/stage-baselines": tracker,
		"expo-router": {},
		"@/features/applications/error": {},
		"@/features/career/hooks": {},
		"@/features/career/undo": undo,
		"@/routes": {},
	});
	tracker.followStageWrites(client, queries.stageScope, (id) => actions.listedApplication(client, id));
	const move = (category, supported = true) =>
		actions.useMoveWithUndo()({
			applications: [{ id: initial.id }],
			lane: pipeline.lanes.find((lane) => lane.category === category),
			supported,
			closedReason: category === "closed" ? "withdrew" : undefined,
			message: `Moved to ${category}`,
		});
	const background = () => {
		AppState.currentState = "background";
		for (const fn of listeners) fn("background");
	};
	const releaseChain = async () => {
		const next = tracker.stageBaselinesFor(client).begin("fixture:alice", new Map([[initial.id, initial]]));
		let settled = false;
		void next.baselines.get(initial.id).then(() => {
			settled = true;
		});
		await until(() => settled);
		next.settle([]);
	};
	const dispose = async () => {
		env.account = "retired";
		for (const run of timers.values()) run();
		await drain();
		client.clear();
	};
	return { env, client, queries, listKey, move, background, releaseChain, dispose };
}

test("native prepared bulk waits for real lane preflight; background dispatch preserves closed-reminder and cache lifecycle", async () => {
	const h = harness();
	h.env.laneGate = deferred();
	try {
		h.move("closed");
		await drain();
		assert.equal(h.env.notices.length, 0);
		assert.equal(h.env.sent.length, 0);
		assert.equal(h.client.getQueryData(h.listKey)[0].status, "applied");
		h.env.laneGate.resolve();
		await until(() => h.env.notices.some((notice) => notice.action?.label === "Undo"));
		assert.equal(h.env.sent.length, 0);
		assert.equal(h.client.getQueryData(h.listKey)[0].status, "closed");
		h.background();
		assert.equal(h.env.sent.length, 1, "transport enters before background listener returns");
		h.background();
		assert.equal(h.env.sent.length, 1);
		await until(() => h.env.reminders.length === 1);
		assert.deepEqual(h.env.reminders, ["fictional-job"]);
		assert.equal(h.client.getQueryState(["documents"]).isInvalidated, true);
	} finally {
		await h.dispose();
	}
});

test("native ready Undo cancels erasure, keeps reminders and releases the queued baseline", async () => {
	const h = harness();
	try {
		h.move("closed");
		await until(() => h.env.notices.some((notice) => notice.action?.label === "Undo"));
		h.env.notices.find((notice) => notice.action?.label === "Undo").action.onPress();
		await h.releaseChain();
		assert.equal(h.env.sent.length, 0);
		assert.deepEqual(h.env.reminders, []);
		assert.equal(h.client.getQueryData(h.listKey)[0].status, "applied");
	} finally {
		await h.dispose();
	}
});

test("native old-account stage receipt cannot clear replacement-account reminders", async () => {
	const h = harness();
	try {
		h.move("closed");
		await until(() => h.env.notices.some((notice) => notice.action?.label === "Undo"));
		h.background();
		assert.equal(h.env.sent.length, 1);
		h.env.account = "bob";
		await until(() =>
			h.client
				.getMutationCache()
				.getAll()
				.some((mutation) => mutation.state.status === "success"),
		);
		assert.deepEqual(h.env.reminders, []);
	} finally {
		await h.dispose();
	}
});

test("native replacement account cannot dispatch while lane preflight is pending or after readiness", async () => {
	for (const pending of [true, false]) {
		const h = harness();
		try {
			if (pending) h.env.laneGate = deferred();
			h.move("closed");
			if (!pending) await until(() => h.env.notices.some((notice) => notice.action?.label === "Undo"));
			h.env.account = "bob";
			if (pending) h.env.laneGate.resolve();
			else h.background();
			await h.releaseChain();
			assert.equal(h.env.sent.length, 0);
			assert.deepEqual(h.env.reminders, []);
		} finally {
			await h.dispose();
		}
	}
});

test("native failed lane preparation releases a queued canonical move without acknowledgement", async () => {
	const h = harness();
	h.env.metadata = false;
	try {
		h.move("interview");
		h.move("offer", false);
		await until(() => h.env.notices.some((notice) => notice.message === "Moved to offer"));
		assert.equal(
			h.env.notices.some((notice) => notice.message === "Moved to interview"),
			false,
		);
		h.background();
		await until(() => h.env.row.status === "offer");
		assert.equal(h.env.sent.length, 1);
		assert.equal(h.env.sent[0].status, "offer");
	} finally {
		await h.dispose();
	}
});

test("native later immediate stage remains visible when an old move becomes ready; partial closure uses canonical reminder state", async () => {
	const h = harness();
	h.env.laneGate = deferred();
	try {
		h.move("interview");
		await drain();
		await h.queries.useApplicationMutations().update.mutateAsync({ id: "fictional-job", status: "offer" });
		h.env.laneGate.resolve();
		await until(() => h.env.notices.some((notice) => notice.message === "Moved to interview"));
		assert.equal(h.client.getQueryData(h.listKey)[0].status, "offer");
		h.background();
		await until(() => h.env.sent.length === 1);
		await drain();
		assert.equal(h.env.row.status, "offer");
		assert.deepEqual(h.env.reminders, []);
	} finally {
		await h.dispose();
	}
	const closed = harness();
	try {
		closed.env.row = { ...closed.env.row, status: "closed" };
		closed.move("closed");
		await until(() => closed.env.notices.some((notice) => notice.action?.label === "Undo"));
		closed.background();
		await until(() => closed.env.reminders.length === 1);
		assert.ok(closed.env.reads > 0, "partial bulk receipt refreshes canonical closure before reminder cleanup");
	} finally {
		await closed.dispose();
	}
});
