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
const nextStep = load("features/applications/next-step.ts", {
	"./stages": stages,
	"@/ui": {},
	"@lingui/core/macro": { plural: (value, forms) => forms.other.replace("#", String(value)), t: String },
});
const list = load("features/applications/list.ts", {
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
};
let capturedQuery;
let listRows = [{ ...summary[0], initialDetail: full[0] }];
const invalidations = [];
const detailKey = ["applications", "detail", { id: "app-a" }, "server-a"];
const queryClient = new QueryClient();
const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
queryClient.invalidateQueries = async (filters) => {
	invalidations.push(filters.queryKey);
	return originalInvalidateQueries(filters);
};
const queries = load("features/applications/queries.ts", {
	react: { useEffect: (effect) => effect() },
	"@tanstack/react-query": {
		useMutation: (options) => options,
		useQuery: (options) => {
			capturedQuery = options;
			return options.queryKey?.[1] === "summary" ? { ...options, data: listRows, dataUpdatedAt: 500 } : options;
		},
		useQueryClient: () => queryClient,
	},
	"@/api/client": { orpc },
	"@/auth/session": { getServer: () => "server-a", useSession: () => ({ status: "signed-in", server: "server-a" }) },
	"@/features/reminders": { syncReminders: async () => undefined },
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
const mutations = queries.useApplicationMutations();
mutations.update.onSettled(undefined, undefined, { id: "app-a" });
assert.ok(invalidations.some((key) => key[0] === "applications"));
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
console.log(
	"PASS summary preserves filtered/grouped/calendar/insights results, detail lookup, and server-isolated query keys",
);
