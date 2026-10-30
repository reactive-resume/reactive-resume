import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const { QueryClient, QueryObserver } = createRequire(new URL("../package.json", import.meta.url))(
	"@tanstack/react-query",
);

function load(path, mocks = {}) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL("../src/" + path, import.meta.url), "utf8"), {
		loader: path.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
	}).code;
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in mocks, "Missing boundary: " + name);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}

const stages = load("features/applications/stages.ts", {
	"@lingui/core/macro": { t: String },
});
const schemaLanes = load("../../../packages/schema/src/applications/lanes.ts", {
	zod: createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod"),
	"./data": {
		APPLICATION_STATUSES: ["saved", "applied", "screening", "interview", "offer", "closed"],
		applicationStatusSchema: createRequire(new URL("../../../packages/schema/package.json", import.meta.url))(
			"zod",
		).z.enum(["saved", "applied", "screening", "interview", "offer", "closed"]),
		applicationClosedReasonSchema: createRequire(new URL("../../../packages/schema/package.json", import.meta.url))(
			"zod",
		).z.enum(["accepted", "not-selected", "withdrew", "accepted-other", "no-response"]),
	},
});
const lanes = load("features/applications/lanes.ts", {
	"@reactive-resume/schema/applications/lanes": schemaLanes,
	"./stages": stages,
});
const history = load("features/applications/history.ts");
const nextStep = load("features/applications/next-step.ts", {
	"./stages": stages,
	"./history": history,
	"@/ui": {},
	"@lingui/core/macro": { plural: (value, forms) => forms.other.replace("#", String(value)), t: String },
});
const list = load("features/applications/list.ts", {
	"./lanes": lanes,
	"./next-step": nextStep,
	"./stages": stages,
});
const schedule = {
	zonedParts(value) {
		const date = new Date(value);
		return { date: date.toISOString().slice(0, 10) };
	},
};
const calendar = load("features/applications-board/calendar.ts", {
	"../reminders/schedule.ts": schedule,
});
const insights = load("features/applications-board/insights.ts", {
	"../applications/history": history,
	"../reminders/schedule.ts": schedule,
});

const stage = (id, value, at) => ({ id, type: "stage", stage: value, at });
const interview = (id, at) => ({
	id,
	type: "interview",
	at,
	kind: "technical",
	durationMinutes: 60,
	location: "Remote",
	notes: "Bring examples",
	participants: [],
	audience: "other",
	timezone: "UTC",
});
const full = [
	{
		id: "app-a",
		company: "Acme",
		role: "Engineer",
		location: "Remote",
		salary: null,
		status: "interview",
		closedReason: null,
		resumeId: "resume-a",
		coverLetterId: null,
		requirements: ["TypeScript"],
		source: "Referral",
		sourceUrl: "https://example.com/job",
		jobDescription: "large posting body",
		postingSource: null,
		matchScore: 90,
		aiMetadata: { extracted: true },
		notes: "private note",
		resumeFileUrl: null,
		resumeFileName: null,
		coverLetterUrl: null,
		coverLetterName: null,
		followUpAt: null,
		followUpNote: null,
		tags: ["priority"],
		contacts: [{ name: "Recruiter", role: "", type: "", email: "recruiter@example.com", phone: "" }],
		activity: [
			stage("stage-a", "applied", "2026-01-01"),
			stage("stage-b", "interview", "2026-01-03"),
			interview("interview-a", "2026-01-05T10:00:00.000Z"),
			{ id: "note-a", type: "note", at: "2026-01-02", text: "private note" },
		],
		appliedAt: new Date("2026-01-01T00:00:00.000Z"),
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-04T00:00:00.000Z"),
	},
	{
		id: "app-b",
		company: "Beta",
		role: "Designer",
		location: null,
		salary: null,
		status: "closed",
		closedReason: "not-selected",
		resumeId: null,
		coverLetterId: null,
		requirements: [],
		source: "Inbound",
		sourceUrl: null,
		jobDescription: "closed posting",
		postingSource: null,
		matchScore: null,
		aiMetadata: null,
		notes: "closed note",
		resumeFileUrl: null,
		resumeFileName: null,
		coverLetterUrl: null,
		coverLetterName: null,
		followUpAt: null,
		followUpNote: null,
		tags: [],
		contacts: [],
		activity: [
			stage("stage-c", "applied", "2026-01-02"),
			{ id: "note-b", type: "note", at: "2026-01-03", text: "closed" },
		],
		appliedAt: new Date("2026-01-02T00:00:00.000Z"),
		createdAt: new Date("2026-01-02T00:00:00.000Z"),
		updatedAt: new Date("2026-01-03T00:00:00.000Z"),
	},
];

const omittedSummaryFields = new Set([
	"jobDescription",
	"requirements",
	"postingSource",
	"aiMetadata",
	"notes",
	"resumeFileUrl",
	"resumeFileName",
	"coverLetterUrl",
	"coverLetterName",
	"sentResumeVersionId",
	"sentCoverLetterVersionId",
	"sentCheckScore",
]);
const summary = full.map((application) =>
	Object.fromEntries(
		Object.entries(application)
			.filter(([key]) => !omittedSummaryFields.has(key))
			.map(([key, value]) => [key, key === "activity" ? value.filter((entry) => entry.type !== "note") : value]),
	),
);
const fullFiltered = list.filterApplications(full, { search: "engineer", tag: "", showClosed: false });
const summaryFiltered = list.filterApplications(summary, { search: "engineer", tag: "", showClosed: false });
assert.deepEqual(
	summaryFiltered.map(({ id }) => id),
	fullFiltered.map(({ id }) => id),
);

const fullGroups = list.groupApplications(full, "next", "desc", new Date("2026-01-04T00:00:00.000Z"));
const summaryGroups = list.groupApplications(summary, "next", "desc", new Date("2026-01-04T00:00:00.000Z"));
assert.deepEqual(
	summaryGroups.map((group) => [group.status, group.data.map(({ id }) => id)]),
	fullGroups.map((group) => [group.status, group.data.map(({ id }) => id)]),
);

const fullEvents = calendar.collectEvents(full, "UTC");
const summaryEvents = calendar.collectEvents(summary, "UTC");
assert.deepEqual(
	summaryEvents.map(({ id, day }) => [id, day]),
	fullEvents.map(({ id, day }) => [id, day]),
);

const tailored = (application) => application.resumeId === "resume-a";
const fullOutcomes = insights.computeOutcomes(full, tailored);
const summaryOutcomes = insights.computeOutcomes(summary, tailored);
assert.deepEqual(summaryOutcomes, fullOutcomes);
assert.deepEqual(insights.countSources(summary), insights.countSources(full));
assert.deepEqual(
	insights.computeTimeline(summary, { now: new Date("2026-01-10T00:00:00.000Z"), timeZone: "UTC", weekStartsOn: 0 }),
	insights.computeTimeline(full, { now: new Date("2026-01-10T00:00:00.000Z"), timeZone: "UTC", weekStartsOn: 0 }),
);

const orpc = {
	applications: {
		listSummary: { queryOptions: ({ input }) => ({ queryKey: ["applications", "summary", input] }) },
		getById: { queryOptions: ({ input }) => ({ queryKey: ["applications", "detail", input] }) },
		create: { mutationOptions: () => ({}) },
		update: { mutationOptions: () => ({}) },
		delete: { mutationOptions: () => ({}) },
		bulkUpdate: { mutationOptions: () => ({}) },
		bulkDelete: { mutationOptions: () => ({}) },
		import: { mutationOptions: () => ({}) },
		stats: { queryKey: () => ["applications", "stats"] },
		tags: { queryKey: () => ["applications", "tags"] },
		key: () => ["applications"],
	},
	documents: { list: { key: () => ["documents"] } },
	career: { workspace: { key: () => ["career", "workspace"] } },
};
let capturedQuery;
let listRows = [{ ...summary[0], initialDetail: full[0] }];
const invalidations = [];
const cleanups = [];
const detailKey = ["applications", "detail", { id: "app-a" }, "server-a"];
const queryClient = new QueryClient();
const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
queryClient.invalidateQueries = async (filters) => {
	invalidations.push(filters.queryKey);
	return originalInvalidateQueries(filters);
};
let laneEndpoint = async () => ({ revision: 1, lanes: schemaLanes.createDefaultApplicationLanes() });
const writes = [];
const client = {
	applications: Object.fromEntries(
		["create", "update", "bulkUpdate"].map((name) => [
			name,
			async (input) => {
				writes.push(input);
				return { id: input.id ?? "created", status: input.status ?? "closed" };
			},
		]),
	),
};
let accountScope = "account-a";
let laneQueryResult;
const laneQueries = load("features/applications/lane-queries.ts", {
	"@tanstack/react-query": { queryOptions: (options) => options, useQuery: (options) => laneQueryResult ?? options },
	"./lanes": lanes,
	"@/api/client": { client: { applications: { lanes: { get: (...args) => laneEndpoint(...args) } } } },
	"@/auth/session": {
		getServer: () => "server-a",
		getAccountScope: () => accountScope,
		useSession: () => ({ status: "signed-in", server: "server-a" }),
	},
});
const reminderCancellations = [];
const toasts = [];
const queries = load("features/applications/queries.ts", {
	"@/ui": { showToast: (toast) => toasts.push(toast) },
	"@lingui/core/macro": { t: String },
	"./lanes": lanes,
	"./lane-queries": laneQueries,
	react: {
		useEffect: (effect) => {
			const cleanup = effect();
			if (cleanup) cleanups.push(cleanup);
		},
		useCallback: (callback) => callback,
		useRef: (value) => ({ current: value }),
	},
	"@tanstack/react-query": {
		useMutation: (options) => options,
		useQuery: (options) => {
			capturedQuery = options;
			return options.queryKey?.[1] === "summary" ? { ...options, data: listRows, dataUpdatedAt: 500 } : options;
		},
		useQueryClient: () => queryClient,
	},
	"@/api/client": { orpc, client },
	"@/auth/session": {
		getServer: () => "server-a",
		getAccountScope: () => accountScope,
		useSession: () => ({ status: "signed-in", server: "server-a" }),
	},
	"@/features/reminders": {
		syncReminders: async (id, targets) => {
			if (!targets.length) reminderCancellations.push(id);
		},
	},
});
const syncListRows = () => {
	queryClient.setQueryData(queries.applicationsListQueryKey("server-a"), listRows, { updatedAt: 500 });
};
syncListRows();

assert.deepEqual(queries.applicationsListQueryOptions("server-a").queryKey, [
	"applications",
	"summary",
	{ includeInitialDetails: 3 },
	"server-a",
]);
assert.deepEqual(queries.applicationsListQueryOptions("server-b").queryKey, [
	"applications",
	"summary",
	{ includeInitialDetails: 3 },
	"server-b",
]);
assert.deepEqual(queries.applicationDetailQueryOptions("app-a", "server-a").queryKey, detailKey);
queries.useApplication("app-a");
assert.deepEqual(capturedQuery.initialData, full[0]);
assert.equal(capturedQuery.staleTime, undefined);
assert.equal(capturedQuery.initialDataUpdatedAt, 500);
listRows = [{ ...summary[0], initialDetail: { ...full[0], status: "closed" } }];
syncListRows();
queries.useApplication("app-a");
assert.equal(capturedQuery.initialData, undefined);
const oldDetail = { ...full[0], notes: "old", updatedAt: new Date("2026-01-01T00:00:00.000Z") };
const newerDetail = { ...full[0], notes: "newer", updatedAt: new Date("2026-01-03T00:00:00.000Z") };
queryClient.setQueryData(detailKey, newerDetail, { updatedAt: 700 });
listRows = [{ ...summary[0], initialDetail: oldDetail }];
syncListRows();
queries.useApplications();
await Promise.resolve();
assert.equal(queryClient.getQueryData(detailKey).notes, "newer");
queryClient.setQueryData(detailKey, oldDetail, { updatedAt: 700 });
listRows = [{ ...summary[0], initialDetail: newerDetail }];
syncListRows();
queries.useApplications();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(queryClient.getQueryData(detailKey).notes, "newer");
queryClient.setQueryData(detailKey, oldDetail);
let resolveOld;
const oldRequest = queryClient.fetchQuery({
	queryKey: detailKey,
	queryFn: () =>
		new Promise((resolve) => {
			resolveOld = resolve;
		}),
});
queries.useApplications();
resolveOld(oldDetail);
await oldRequest.catch(() => undefined);
assert.equal(queryClient.getQueryData(detailKey).notes, "newer");
const mutations = queries.useApplicationMutations();
mutations.update.onSettled(undefined, undefined, { id: "app-a" });
assert.ok(invalidations.some((key) => key[0] === "applications"));
assert.ok(invalidations.some((key) => key[0] === "career" && key[1] === "workspace"));
const observerClient = new QueryClient();
const cachedDetail = { ...full[0], resumeFileUrl: "/uploads/resume.pdf", resumeFileName: "resume.pdf" };
const observerKey = ["application-detail", cachedDetail.id];
observerClient.setQueryData(observerKey, cachedDetail);
const observer = new QueryObserver(observerClient, {
	queryKey: observerKey,
	queryFn: async () => {
		throw new Error("refresh failed");
	},
	retry: false,
	staleTime: 0,
});
await observer.refetch();
const failedRefresh = observer.getCurrentResult();
assert.equal(failedRefresh.isError, true);
assert.equal(failedRefresh.data?.id, cachedDetail.id);
assert.equal(Boolean(failedRefresh.data), true);
assert.equal(failedRefresh.data?.resumeFileUrl, "/uploads/resume.pdf");
observer.destroy();
observerClient.clear();
const refreshBase = { ...full[0], notes: "cached newer", updatedAt: new Date("2026-01-03T00:00:00.000Z") };
queryClient.setQueryData(detailKey, refreshBase, { updatedAt: 700 });
let resolveRefresh;
const refreshObserver = new QueryObserver(queryClient, {
	queryKey: detailKey,
	queryFn: () =>
		new Promise((resolve) => {
			resolveRefresh = resolve;
		}),
	retry: false,
});
const unsubscribeRefresh = refreshObserver.subscribe(() => {});
const refreshRequest = refreshObserver.refetch();
await Promise.resolve();
assert.equal(refreshObserver.getCurrentResult().fetchStatus, "fetching");
listRows = [{ ...summary[0], initialDetail: oldDetail }];
syncListRows();
queries.useApplications();
assert.equal(refreshObserver.getCurrentResult().fetchStatus, "fetching");
const refreshed = { ...refreshBase, notes: "refreshed latest", updatedAt: new Date("2026-01-05T00:00:00.000Z") };
resolveRefresh(refreshed);
await refreshRequest;
assert.equal(queryClient.getQueryData(detailKey).notes, "refreshed latest");
unsubscribeRefresh();
refreshObserver.destroy();
queryClient.clear();
const prefetchCalls = [];
const pendingPrefetches = new Map();
orpc.applications.getById.queryOptions = ({ input }) => ({
	queryKey: ["applications", "detail", input],
	queryFn: () => {
		prefetchCalls.push(input.id);
		return new Promise((resolve, reject) => pendingPrefetches.set(input.id, { resolve, reject }));
	},
});
queryClient.setDefaultOptions({ queries: { retry: false } });
const onVisible = queries.useApplicationDetailPrefetch();
const visible = (...ids) =>
	onVisible({ viewableItems: [{ item: { title: "Interview" } }, ...ids.map((id) => ({ item: { id } }))] });
const waitForPrefetch = () => new Promise((resolve) => setTimeout(resolve, 150));
const finishPrefetches = async () => {
	for (const [id, pending] of pendingPrefetches) pending.resolve({ ...full[0], id });
	pendingPrefetches.clear();
	await new Promise((resolve) => setImmediate(resolve));
};
visible("skipped");
visible("visible-a", "visible-b", "not-in-first-two");
await waitForPrefetch();
assert.deepEqual(prefetchCalls, ["visible-a", "visible-b"]);
visible("visible-c", "visible-d");
await waitForPrefetch();
assert.equal(prefetchCalls.length, 2, "only two detail requests may run concurrently");
await finishPrefetches();
for (let offset = 2; offset < 14; offset += 2) {
	visible("visible-" + offset, "visible-" + (offset + 1));
	await waitForPrefetch();
	await finishPrefetches();
}
assert.equal(prefetchCalls.length, 14, "completed requests free slots for later visible applications");
visible("visible-a", "visible-b");
await waitForPrefetch();
assert.equal(prefetchCalls.length, 14, "cached details do not need another prefetch");
queryClient.clear();
const onRetryVisible = queries.useApplicationDetailPrefetch();
const retryVisible = () => onRetryVisible({ viewableItems: [{ item: { id: "retry" } }] });
retryVisible();
await waitForPrefetch();
pendingPrefetches.get("retry").reject(new Error("temporary failure"));
pendingPrefetches.clear();
await new Promise((resolve) => setImmediate(resolve));
retryVisible();
await waitForPrefetch();
assert.equal(prefetchCalls.filter((id) => id === "retry").length, 2, "failed prefetch does not block retry");
await finishPrefetches();
onRetryVisible({ viewableItems: [{ item: { id: "unmounted" } }] });
for (const cleanup of cleanups) cleanup();
await waitForPrefetch();
assert.ok(!prefetchCalls.includes("unmounted"), "unmount cancels the pending prefetch timer");

// Same-category lane changes reset only time in lane, not the no-reply clock.
const appliedLaneMove = {
	...full[0],
	status: "applied",
	laneId: "awaiting-review",
	activity: [
		{ ...stage("applied", "applied", "2026-01-01"), laneId: "applied" },
		{ ...stage("lane-only", "applied", "2026-01-08"), laneId: "awaiting-review", canonicalTransition: false },
	],
};
assert.equal(nextStep.daysInStage(appliedLaneMove, new Date("2026-01-11")), 3);
assert.deepEqual(nextStep.getNextStep(appliedLaneMove, new Date("2026-01-11")), { kind: "no-reply", days: 10 });
for (const status of ["closed", "applied"]) {
	const outcomes = insights.computeOutcomes(
		[
			{
				...appliedLaneMove,
				status,
				closedReason: status === "closed" ? "not-selected" : null,
				activity: [
					stage("applied", "applied", "2026-01-01"),
					{ ...stage("ghosted", "closed", "2026-01-05"), closedReason: "no-response" },
					{ ...stage("rejected", "closed", "2026-01-10"), closedReason: "not-selected", canonicalTransition: false },
					...(status === "applied" ? [stage("reopened", "applied", "2026-01-11")] : []),
				],
			},
		],
		() => false,
	);
	assert.equal(outcomes.heardBack, 1, "recorded rejection survives reopening");
	assert.equal(outcomes.medianDaysToReply, 9, "reply date uses the recorded outcome change");
}
assert.equal(history.currentLaneEntry(appliedLaneMove).id, "lane-only");
assert.equal(
	history.currentLaneEntry({
		...appliedLaneMove,
		activity: [...appliedLaneMove.activity, stage("legacy-edited", "applied", "2026-01-10")],
	}).id,
	"lane-only",
	"legacy date edits cannot replace an explicit lane anchor",
);
const sparseHistory = {
	...appliedLaneMove,
	status: "screening",
	activity: [{ ...stage("lane-only", "screening", "2026-01-20"), canonicalTransition: false }],
};
assert.equal(insights.computeOutcomes([sparseHistory], () => false).heardBack, 0);
assert.deepEqual(
	insights
		.computeTimeline([sparseHistory], { now: new Date("2026-01-24"), timeZone: "UTC", weekStartsOn: 0, weeks: 4 })
		.map(({ count }) => count),
	[1, 0, 0, 0],
);

const defaults = schemaLanes.createDefaultApplicationLanes();
assert.deepEqual(
	list
		.groupApplications(
			defaults.map((lane) => ({ ...full[0], id: lane.id, status: lane.category, laneId: lane.id })),
			"role",
			"asc",
			new Date("2026-01-11"),
			defaults,
		)
		.map(({ status }) => status),
	["interview", "offer", "screening", "applied", "saved", "closed"],
	"server upgrade retains priority order in List",
);
const custom = { ...defaults[1], id: "awaiting-review", systemKey: null, label: "Awaiting review", position: 2 };
const ghosted = {
	...defaults[5],
	id: "ghosted",
	systemKey: null,
	label: "Ghosted",
	closedReason: "no-response",
	position: 1,
};
const pipeline = [
	defaults[0],
	ghosted,
	custom,
	...defaults.slice(1).map((lane, index) => ({ ...lane, position: index + 3 })),
];
assert.equal(
	lanes.nextActiveLane(pipeline, { status: "saved" }).id,
	"awaiting-review",
	"next action follows configured order and skips terminal lanes",
);
assert.equal(lanes.nextActiveLane(pipeline, { status: "closed", laneId: "ghosted" }), null);
assert.deepEqual(
	lanes.compatibleReplacements(pipeline, ghosted),
	[],
	"a neutral Closed lane cannot replace a preset Ghosted lane",
);
assert.deepEqual(lanes.laneInput(custom, false), { status: "applied" });
assert.deepEqual(lanes.laneInput(custom, true), { laneId: "awaiting-review" });
assert.equal(
	lanes.getLaneHistoryLabel([{ ...custom, label: "Renamed" }], {
		...stage("history", "applied", "2026-01-08"),
		laneId: custom.id,
		laneLabel: "Awaiting review",
	}),
	"Awaiting review",
);
assert.equal(
	lanes.getLaneHistoryLabel([{ ...custom, label: "Renamed" }], {
		...stage("history", "applied", "2026-01-08"),
		laneId: custom.id,
		laneLabel: null,
	}),
	"Applied",
	"null snapshot preserves the translated category name",
);
const retired = { ...custom, id: "retired", retiredAt: new Date("2026-01-09") };
const retirementHistory = {
	...appliedLaneMove,
	laneId: "applied",
	activity: [
		{ ...stage("initial", "applied", "2026-01-01"), laneId: "applied" },
		{ ...stage("retired-entry", "applied", "2026-01-08"), laneId: "retired", canonicalTransition: false },
	],
};
assert.equal(
	history.currentLaneEntry(retirementHistory, [...pipeline, retired]).id,
	"retired-entry",
	"retirement preserves residence time even when the replacement has earlier history",
);
assert.equal(nextStep.daysInStage(retirementHistory, new Date("2026-01-11"), [...pipeline, retired]), 3);
const grouped = list.groupApplications(
	[
		{ ...appliedLaneMove, id: "custom" },
		{ ...appliedLaneMove, id: "legacy", laneId: null },
		{ ...appliedLaneMove, id: "retired", laneId: "retired" },
		{ ...full[1], id: "ghosted", laneId: "ghosted", closedReason: "no-response" },
	],
	"role",
	"asc",
	new Date("2026-01-11"),
	[...pipeline, retired],
);
assert.deepEqual(Object.fromEntries(grouped.map((group) => [group.status, group.data.map(({ id }) => id)])), {
	"awaiting-review": ["custom"],
	applied: ["legacy"],
	ghosted: ["ghosted"],
	retired: ["retired"],
});
assert.deepEqual(list.visibleSelection(grouped, new Set(["awaiting-review"]), new Set(["custom", "legacy"])), [
	"legacy",
]);
const board = load("features/applications-board/board.ts");
const pending = { id: "custom", from: "applied", to: "awaiting-review" };
assert.equal(board.keepPending(pending, [{ id: "custom", status: "applied", laneId: "awaiting-review" }]), null);
assert.equal(board.keepPending(pending, [{ id: "custom", status: "applied", laneId: "applied" }]), pending);
assert.equal(board.pendingAfterError(pending, "custom", "awaiting-review"), null);
assert.equal(board.pendingAfterError(pending, "custom", "other"), pending, "late failure must not clear a newer move");

// A summary can contain a stale detail at the same category and outcome but another lane.
listRows = [{ ...summary[0], laneId: "new-lane", initialDetail: { ...full[0], laneId: "old-lane" } }];
syncListRows();
queries.useApplication("app-a");
assert.equal(capturedQuery.initialData, undefined);
queryClient.setQueryData(detailKey, oldDetail);
queries.useApplications();
assert.equal(queryClient.getQueryData(detailKey), oldDetail);

// Endpoint absence alone enables compatibility; auth, network and server errors retain their failure.
const metadata = laneQueries.applicationLanesQueryOptions("server-a", "account-a");
laneQueryResult = { isError: true, isSuccess: false, data: undefined };
const offlineLanes = laneQueries.useApplicationLanes();
assert.equal(offlineLanes.ready, true, "metadata outage permits canonical default writes");
assert.equal(offlineLanes.supported, false);
assert.deepEqual(lanes.laneInput(offlineLanes.active[0], offlineLanes.supported), { status: "saved" });
laneQueryResult = undefined;
assert.notDeepEqual(metadata.queryKey, laneQueries.applicationLanesQueryOptions("server-a", "account-b").queryKey);
assert.notDeepEqual(metadata.queryKey, laneQueries.applicationLanesQueryOptions("server-b", "account-a").queryKey);
const controller = new AbortController();
laneEndpoint = async () => {
	throw { code: "NOT_FOUND" };
};
assert.equal((await metadata.queryFn({ signal: controller.signal })).supported, false);
for (const error of [
	{ code: "UNAUTHORIZED" },
	{ code: "FORBIDDEN" },
	new TypeError("Network failed"),
	{ code: "INTERNAL_SERVER_ERROR" },
]) {
	laneEndpoint = async () => {
		throw error;
	};
	await assert.rejects(metadata.queryFn({ signal: controller.signal }), (cause) => cause === error);
}
laneEndpoint = async () => {
	throw { code: "NOT_FOUND" };
};
queryClient.setQueryData(metadata.queryKey, { supported: false, pipeline: { revision: 0, lanes: defaults } });
await assert.rejects(mutations.update.mutationFn({ id: "app-a", laneId: "ghosted" }));
await assert.rejects(mutations.create.mutationFn({ company: "Acme", role: "Engineer", laneId: "ghosted" }));
await assert.rejects(mutations.bulkUpdate.mutationFn({ ids: ["app-a"], laneId: "ghosted" }));
assert.equal(writes.length, 0, "old server must never receive lane-only writes that it might silently strip");
await mutations.update.mutationFn({ id: "app-a", status: "applied" });
assert.equal(writes.length, 1, "canonical fallback remains writable");

queryClient.setQueryData(metadata.queryKey, { supported: true, pipeline: { revision: 4, lanes: pipeline } });
listRows = [{ ...summary[0], status: "applied", laneId: "applied" }];
syncListRows();
const rollback = await mutations.update.onMutate({ id: "app-a", laneId: "awaiting-review" });
assert.equal(queryClient.getQueryData(queries.applicationsListQueryKey())[0].laneId, "awaiting-review");
mutations.update.onError(new Error("request failed"), {}, rollback);
assert.equal(queryClient.getQueryData(queries.applicationsListQueryKey())[0].laneId, "applied");
listRows = [{ ...summary[0], status: "applied", laneId: "awaiting-review" }];
syncListRows();
await mutations.update.onMutate({ id: "app-a", status: "applied", company: "Updated" });
assert.equal(
	queryClient.getQueryData(queries.applicationsListQueryKey())[0].laneId,
	"awaiting-review",
	"legacy unchanged-status metadata edit preserves custom lane optimistically",
);
reminderCancellations.length = 0;
mutations.update.onSuccess({ id: "app-a", status: "closed" }, { id: "app-a", laneId: "ghosted" });
assert.deepEqual(
	reminderCancellations,
	["app-a"],
	"lane-only move cancels reminders from authoritative canonical result",
);
mutations.update.onSuccess({ id: "app-b", status: "applied" }, { id: "app-b", status: "closed" });
assert.deepEqual(reminderCancellations, ["app-a"], "input alone cannot prove closure or opt in to reminders");
orpc.applications.listSummary.queryOptions = ({ input }) => ({
	queryKey: ["applications", "summary", input],
	queryFn: async () => [
		{ id: "app-a", status: "closed" },
		{ id: "app-b", status: "applied" },
		{ id: "not-selected", status: "closed" },
	],
});
await mutations.bulkUpdate.onSuccess({ updated: 1 }, { ids: ["app-a", "app-b"], laneId: "ghosted" });
assert.deepEqual(
	reminderCancellations,
	["app-a", "app-a"],
	"bulk cancellation selects only returned closed applications in this operation",
);

const beforeFailedRead = reminderCancellations.length;
orpc.applications.listSummary.queryOptions = ({ input }) => ({
	queryKey: ["applications", "summary", input],
	queryFn: async () => {
		throw new Error("Offline");
	},
});
await mutations.bulkUpdate.onSuccess({ updated: 1 }, { ids: ["app-b"], laneId: "ghosted" });
assert.equal(
	reminderCancellations.length,
	beforeFailedRead + 1,
	"complete receipt and immutable closed target cancel reminders without a follow-up read",
);
await mutations.bulkUpdate.onSuccess({ updated: 1 }, { ids: ["app-b", "unknown"], laneId: "ghosted" });
assert.equal(reminderCancellations.length, beforeFailedRead + 1, "partial receipt needs authoritative row results");
assert.equal(toasts.length, 1, "confirmed bulk write reports failed device reminder refresh");
accountScope = "account-b";
queryClient.setQueryData(queries.applicationsListQueryKey(), [{ id: "account-b-application" }]);
mutations.update.onError(new Error("late failure"), {}, rollback);
assert.equal(
	queryClient.getQueryData(queries.applicationsListQueryKey())[0].id,
	"account-b-application",
	"old-account rollback cannot rehydrate another account's list",
);
mutations.update.onSuccess({ id: "app-a", status: "closed" }, { id: "app-a", laneId: "ghosted" });
assert.equal(reminderCancellations.at(-1), "app-a", "confirmed close cancels its device reminder after account switch");
mutations.remove.onSuccess(undefined, { id: "deleted" });
mutations.bulkDelete.onSuccess(undefined, { ids: ["deleted-bulk"] });
assert.deepEqual(reminderCancellations.slice(-2), ["deleted", "deleted-bulk"]);
accountScope = "account-a";
queryClient.clear();
console.log(
	"PASS native application summaries, lanes/history, old-server write guards, cache rollback and authoritative reminder cancellation",
);
