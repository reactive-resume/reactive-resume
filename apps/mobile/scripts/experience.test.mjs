// Shipped component actions run against native/export/network boundaries; no real account or outbound sharing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
let hooks = [];
let cursor = 0;
const react = {
	createElement: element,
	useCallback: (fn) => fn,
	useState(initial) {
		const index = cursor++;
		if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
		return [hooks[index], (value) => (hooks[index] = typeof value === "function" ? value(hooks[index]) : value)];
	},
	useRef(initial) {
		const [value] = react.useState(() => ({ current: initial }));
		return value;
	},
};
const calls = [];
const routes = {
	builder: (id, tab) => `/builder/${id}/${tab}`,
	application: (id, tab) => `/applications/${id}/${tab}`,
	applications: (view = "list") => (view === "list" ? "/applications" : `/applications/${view}`),
	new: (context = "documents") => (context === "documents" ? "/new" : `/new?context=${context}`),
	newJob: () => "/applications?create=1",
};
const router = { push: (href) => calls.push(href), back() {} };
const theme = {
	space: { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s12: 48 },
	size: { sheetShare: 440 },
	radius: { rLg: 4 },
	motion: { d2: 200 },
	colors: { bg: "#fff", ink: "#111", ink3: "#777", line: "#ddd" },
};
const ui = Object.fromEntries(
	[
		"Banner",
		"Button",
		"Card",
		"ChipInput",
		"ConfirmDialog",
		"Icon",
		"IconButton",
		"ListGroup",
		"ListRow",
		"SelectSheet",
		"Switch",
		"Text",
		"TextArea",
		"TextField",
		"Segmented",
		"Skeleton",
	].map((name) => [name, name]),
);
ui.useTheme = () => theme;
ui.showToast = (value) => calls.push(value);
ui.listItemMotion = () => ({});
ui.listLayout = {};
ui.useFirstAppearance = () => false;
const mocks = {
	react,
	"react-native": { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Platform: { OS: "android" } },
	"expo-router": { useRouter: () => router, useLocalSearchParams: () => ({}), Stack: { Screen: "StackScreen" } },
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"@lingui/core/macro": { t: tag, plural: (value, forms) => forms.other.replace("#", String(value)) },
	"@/routes": { routes },
	"@/features/ai/web-access": { WebAccessAttention: "WebAccessAttention" },
	"@/ui": ui,
	"@/ui/use-pull-refresh": { usePullRefresh: () => ({ refreshing: false, onRefresh: () => undefined }) },
	"react-native-reanimated": {
		View: "Animated.View",
		useSharedValue: (initial) => ({ get: () => initial, set() {} }),
		useAnimatedStyle: () => ({}),
		withTiming: (value) => value,
		withSpring: (value) => value,
	},
};
function load(path, extra = {}) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
		loader: path.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	}).code;
	const dependencies = { ...mocks, ...extra };
	new Function("React", "require", "module", "exports", code)(
		react,
		(name) => {
			assert.ok(name in dependencies, `Missing boundary: ${name}`);
			return dependencies[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props.children)];
const render = (component, props) => {
	cursor = 0;
	return component(props);
};
const reset = () => {
	hooks = [];
	calls.length = 0;
};
const control = (tree, label) => {
	const found = nodes(tree).find((node) => node.props.label === label);
	assert.ok(found, `Missing user action: ${label}`);
	return found.props;
};
const settle = async () => {
	for (let index = 0; index < 20; index++) await Promise.resolve();
};

const resume = { id: "resume-a", name: "Fictional resume", data: { basics: { name: "Alex Example" } } };
let state = { document: resume, status: "saved", conflict: null, flush: async () => calls.push("flush") };
const draftBoundary = {
	useResumeStore: { getState: () => state },
	useLetterStore: { getState: () => ({ document: null }) },
};
const document = load("features/share/document.ts", { "@/draft": draftBoundary });
const { safeFileName } = load("features/share/model.ts");
assert.equal(safeFileName("李明-Resume"), "李明-Resume", "Native exports keep a Unicode full name intact");
assert.equal(
	safeFileName('../../etc/passwd\r\nX-Injected: "yes"'),
	"etcpasswdX-Injected yes",
	"Native exports remove traversal, control characters, quotes and separators",
);
const exportedBytes = new Uint8Array([1, 2, 3]);
const translatedLetterWords = {
	greeting: (name) => `Liebe ${name},`,
	teamGreeting: "Liebes Team & Personal,",
	hiringTeam: "Personal + Team",
	signOff: "Mit freundlichen Grüßen",
};
let exportPath;
const { exportFile } = load("features/share/files.ts", {
	"expo-file-system": {
		Directory: class {},
		File: class {
			async write(bytes) {
				assert.deepEqual(bytes, exportedBytes);
			}
		},
		Paths: {},
	},
	"expo-print": {},
	"expo-sharing": {},
	"@reactive-resume/resume/export-sections": {},
	"./letter": { letterWords: async () => translatedLetterWords },
	"./messages": {},
	"./model": { safeFileName },
	"@/preview/pipeline": {},
	"@/api/client": {
		client: { coverLetters: { getById: async () => ({ style: { metadata: { page: { locale: "de-DE" } } } }) } },
		rest: async (path) => {
			exportPath = new URL(path, "https://example.test");
			return { ok: true, arrayBuffer: async () => exportedBytes.buffer };
		},
	},
});
for (const format of ["docx", "odt", "md", "json"]) {
	await exportFile({ directory: {}, id: "letter-a", name: "Letter", format, letter: true });
	assert.equal(exportPath.pathname, `/cover-letters/letter-a/exports/${format}`);
	assert.deepEqual(
		Object.fromEntries(exportPath.searchParams),
		format === "json"
			? {}
			: {
					"words[greeting]": "Liebe {name},",
					"words[teamGreeting]": translatedLetterWords.teamGreeting,
					"words[hiringTeam]": translatedLetterWords.hiringTeam,
					"words[signOff]": translatedLetterWords.signOff,
				},
		"Localized letter exports must use OpenAPI object query parameters",
	);
}
let rejectExport = false;
let releaseExport;
let holdExport = false;
const exportBoundary = {
	exportDirectory: () => "cache-batch",
	exportFile: async (options) => {
		calls.push({ export: options });
		if (holdExport) await new Promise((resolve) => (releaseExport = resolve));
		if (rejectExport) throw new Error("Export unavailable");
		return { uri: "file://fictional-resume.pdf" };
	},
	shareExport: async (file, format) => calls.push({ shared: format, uri: file.uri }),
	printResume: async () => calls.push("print"),
};
const { DownloadTab } = load("features/share/download.tsx", {
	"expo-web-browser": { openBrowserAsync: async (url) => calls.push({ browser: url }) },
	"@reactive-resume/resume/ats": { lintResumeForAts: () => ({ findings: [] }) },
	"@reactive-resume/resume/cover-letter": {},
	"./document": document,
	"./files": exportBoundary,
	"./letter": {},
	"./model": { safeFileName },
	"@/api/client": { client: {} },
	"@/draft": draftBoundary,
	"@/features/applications/queries": { useApplications: () => ({ data: [] }) },
});
const { ExportScreen } = load("features/share/export-screen.tsx", {
	"expo-network": { useNetworkState: () => ({ isConnected: true }) },
	"react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" },
	"./document": { useShareDocument: () => state },
	"./download": { DownloadTab },
	"@/auth/session": { useSession: () => ({ status: "signed-in" }) },
	"@/features/document-menu": { DocumentMenu: "DocumentMenu" },
	"@/features/history/history": { HistoryPanel: "HistoryPanel" },
});
reset();
let tree = render(ExportScreen, { id: resume.id });
assert.equal(control(tree, "Download & history").value, "download", "Ordinary sharing must start with the file action");
assert.ok(nodes(tree).some((node) => node.type === DownloadTab));
reset();
tree = render(ExportScreen, { id: resume.id, history: true });
assert.equal(control(tree, "Download & history").value, "history", "Explicit version history keeps its destination");

reset();
tree = render(DownloadTab, { resume, offline: false });
assert.equal(control(tree, "File name").value, "Alex Example-Resume");
const communityInvite = (view) => nodes(view).find((node) => node.props.title === "Get resume feedback on Discord");
assert.equal(communityInvite(tree), undefined, "No community invitation before an export");
holdExport = true;
control(tree, "Share PDF").onPress();
control(tree, "Share PDF").onPress();
await settle();
assert.equal(calls.filter((call) => call?.export).length, 1, "Repeated taps must not duplicate generation");
assert.equal(
	communityInvite(render(DownloadTab, { resume, offline: false })),
	undefined,
	"No invitation while preparing",
);
releaseExport();
await settle();
holdExport = false;
assert.equal(calls.filter((call) => call?.shared === "pdf").length, 1);
assert.equal(calls.find((call) => call?.export).export.name, "Alex Example-Resume");
tree = render(DownloadTab, { resume, offline: false });
assert.ok(communityInvite(tree), "A prepared export offers optional peer feedback");
assert.equal(
	calls.some((call) => call?.browser),
	false,
	"Export never opens Discord automatically",
);
await communityInvite(tree).props.onPress();
assert.equal(calls.at(-1).browser, "https://discord.gg/9kAqrGcwn5");
control(tree, "Print").onPress();
await settle();
assert.equal(
	communityInvite(render(DownloadTab, { resume, offline: false })),
	undefined,
	"Printing does not trigger an invitation",
);

reset();
state = {
	...state,
	status: "offline",
	flush: async () => {
		throw new Error("Offline must not wait for a save");
	},
};
tree = render(DownloadTab, { resume, offline: true });
control(tree, "Share PDF").onPress();
await settle();
assert.equal(calls.filter((call) => call?.shared === "pdf").length, 1, "Local PDF must remain available offline");

reset();
state = { ...state, status: "error", flush: async () => undefined };
tree = render(DownloadTab, { resume, offline: false });
control(tree, "Share PDF").onPress();
await settle();
assert.equal(calls.filter((call) => call?.export).length, 0, "An unsaved online document must not export stale text");

reset();
state = { ...state, status: "saved" };
tree = render(DownloadTab, { resume, offline: false });
control(tree, "File format").onChange("docx");
tree = render(DownloadTab, { resume, offline: false });
rejectExport = true;
control(tree, "Download DOCX").onPress();
await settle();
tree = render(DownloadTab, { resume, offline: false });
assert.ok(nodes(tree).some((node) => node.props.message === "Export unavailable"));
assert.equal(communityInvite(tree), undefined, "Failed exports do not trigger an invitation");
rejectExport = false;
control(tree, "Share PDF instead").onPress();
await settle();
assert.equal(
	calls.filter((call) => call?.shared === "pdf").length,
	1,
	"Failed alternate format retains a working PDF fallback",
);

const stages = load("features/applications/stages.ts");
const history = load("features/applications/history.ts");
const zod = createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod");
const applicationData = load("../../../packages/schema/src/applications/data.ts", {
	zod,
	"@reactive-resume/utils/timezone": { timezoneSchema: zod.z.string() },
});
const schemaLanes = load("../../../packages/schema/src/applications/lanes.ts", { zod, "./data": applicationData });
const lanes = load("features/applications/lanes.ts", {
	"@reactive-resume/schema/applications/lanes": schemaLanes,
	"./stages": stages,
});
const defaultLanes = schemaLanes.createDefaultApplicationLanes();
const laneQuery = {
	useApplicationLanes: () => ({ lanes: defaultLanes, active: defaultLanes, supported: false, ready: true }),
};
const nextSteps = load("features/applications/next-step.ts", { "./stages": stages, "./history": history });
const time = { locale: "en-US", timeZone: "UTC", when: String, time: String, day: String, utcDay: String };
const { StageStepper, NextStepCard, WhatYouSent } = load("features/application-detail/sections.tsx", {
	"@tanstack/react-query": {},
	"expo-document-picker": {},
	"expo-file-system": {},
	"expo-sqlite/kv-store": {},
	"expo-web-browser": {},
	"./attachment": {},
	"./notes-queue": { createNotesQueue: () => ({}) },
	"./hooks": {
		useDocuments: () => ({ data: [] }),
		useDetailMutations: () => ({ createLetter: { isPending: false } }),
		useNow: () => new Date(),
		useUserTime: () => time,
		followUpReminder: () => null,
		interviewReminder: () => null,
	},
	"./sheets": { FollowUpSheet: "FollowUpSheet", ReminderSheet: "ReminderSheet" },
	"@/api/client": {},
	"@/auth/session": {},
	"@/draft": {},
	"@/features/applications/error": {},
	"@/features/applications/history": history,
	"@/features/applications/lane-notice": { LaneNotice: "LaneNotice" },
	"@/features/applications/lane-queries": laneQuery,
	"@/features/applications/lanes": lanes,
	"@/features/applications/next-step": nextSteps,
	"@/features/applications/stages": stages,
	"@/features/applications/queries": {
		useApplicationMutations: () => ({ update: { isPending: false, mutate: (input) => calls.push(input) } }),
	},
	"@/features/reminders": {},
	"@/features/share/files": {},
});
const application = {
	id: "job-a",
	status: "saved",
	activity: [],
	appliedAt: new Date().toISOString(),
	followUpAt: null,
};
reset();
tree = render(StageStepper, { application, onMarkApplied: () => calls.push("mark-applied") });
assert.equal(
	nodes(tree).filter((node) => node.props.accessibilityRole === "tab").length,
	0,
	"Progress must not masquerade as navigation",
);
assert.equal(
	nodes(tree).filter((node) => node.type === "Pressable").length,
	0,
	"Progress labels must not mutate records",
);
assert.deepEqual(calls, []);
control(tree, "Change lane").onChange("applied");
assert.deepEqual(calls, ["mark-applied"], "Explicit Saved → Applied still captures submission details");
control(tree, "Change lane").onChange("interview");
assert.deepEqual(calls.at(-1), { id: "job-a", status: "interview" });

for (const [resumeId, coverLetterId] of [
	[null, null],
	["resume-a", null],
	[null, "letter-a"],
	["resume-a", "letter-a"],
]) {
	reset();
	tree = render(WhatYouSent, { application: { ...application, resumeId, coverLetterId } });
	assert.equal(
		nodes(tree).filter((node) => node.type === "Card").length,
		resumeId || coverLetterId ? 1 : 0,
		"Only linked documents should create a card; an empty card leaves a stray border",
	);
	assert.equal(
		nodes(tree).filter((node) => node.type === "ListRow").length,
		Number(!!resumeId) + Number(!!coverLetterId),
	);
	assert.equal(
		nodes(tree).some((node) => node.props.label === "Prepare a resume"),
		!resumeId,
	);
	assert.equal(
		nodes(tree).some((node) => node.props.label === "Write a letter"),
		!coverLetterId,
	);
}

for (const [overrides, label, destination] of [
	[{}, "Prepare application", "apply"],
	[{ status: "applied" }, "Review application", "apply"],
	[{ status: "applied", followUpAt: "2000-01-01T09:00:00Z" }, "Draft a follow-up", "messages"],
	[
		{
			status: "interview",
			activity: [
				{ id: "interview-a", type: "interview", kind: "technical", at: "2099-01-01T12:00:00Z", durationMinutes: 60 },
			],
		},
		"Prepare for interview",
		"prepare",
	],
	[{ status: "closed" }, "View saved work", "saved"],
]) {
	reset();
	tree = render(NextStepCard, { application: { ...application, ...overrides }, onOpenInterview() {} });
	control(tree, label).onPress();
	assert.equal(calls.at(-1), `/applications/job-a/${destination}`);
	if (!overrides.status) assert.ok(!nodes(tree).some((node) => node.props.label === "Schedule an interview"));
}
console.log(
	"PASS file-first sharing, single-flight/current-document/offline PDF export, fallback, explicit stage edits and state-aware next actions",
);

// Applications empty states must offer an action that changes the visible collection.
let applications = [];
let applicationSearch = "";
const listLogic = load("features/applications/list.ts", {
	"./next-step": { getNextStep: () => ({ kind: "none" }) },
	"./stages": { LIST_ORDER: ["saved", "applied", "closed"] },
	"./lanes": lanes,
});
const { ApplicationsListScreen } = load("features/applications/list-screen.tsx", {
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en" } }) },
	"./add-sheet": { AddApplicationSheet: "AddApplicationSheet" },
	"./error": { applicationError: String },
	"./lane-queries": laneQuery,
	"./lanes": lanes,
	"./list": listLogic,
	"./next-step": { getNextStep: () => ({}), describeNextStep: () => ({ title: "Saved" }) },
	"./queries": {
		useApplications: () => ({ data: applications }),
		useApplicationMutations: () => ({}),
		useApplicationDetailPrefetch: () => () => {},
	},
	"./stages": { PIPELINE: [], CLOSED_REASONS: [], getStageColor: () => "gray", getStageLabel: (value) => value },
	"@/auth/session": { useSession: () => ({ status: "signed-in", server: "fixture" }) },
	"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => ({ timeZone: "UTC" }) },
	"@/features/applications-board/views": { ApplicationsViewFrame: "ApplicationsViewFrame" },
	"@/features/applications-board/search": {
		useApplicationSearch: () => ({
			search: applicationSearch,
			setSearch: (value) => {
				applicationSearch = value;
			},
		}),
	},
	"@/routes": { routes: { ...routes, applicationDetails: (id) => `/applications/${id}` } },
	"react-native": { View: "View", Pressable: "Pressable", SectionList: "SectionList" },
	"@/ui": { ...ui, Screen: "Screen", EmptyState: "EmptyState", Sheet: "Sheet", SelectSheet: "SelectSheet" },
});
reset();
const List = render(ApplicationsListScreen, {}).type;
const listView = () => render(List, {});
let listTree = listView();
let sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(
	sectionList.props.ListEmptyComponent.props.action.label,
	"Save a job",
	"new collection has creation action",
);
const job = {
	id: "closed-job",
	role: "Engineer",
	company: "Example",
	status: "closed",
	tags: [],
	contacts: [],
	updatedAt: "2026-10-19T10:00:00Z",
};
applications = [job];
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.ListEmptyComponent.props.title, "All your applications are closed");
assert.equal(sectionList.props.ListEmptyComponent.props.action.label, "Show closed");
sectionList.props.ListEmptyComponent.props.action.onPress();
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.sections[0].data[0].id, job.id, "Show closed reveals hidden records");
applicationSearch = "missing company";
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.ListEmptyComponent.props.action.label, "Clear filters");
sectionList.props.ListEmptyComponent.props.action.onPress();
assert.equal(applicationSearch, "");
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.sections.length, 0, "Clear filters restores default closed visibility");
applications = [{ ...job, status: "saved" }];
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
const rowTree = sectionList.props.renderItem({ item: applications[0] });
const row = nodes(rowTree).find((node) => node.type === "ListRow");
assert.equal(row.props.onLongPress, undefined, "list long press never enters bulk selection");
row.props.onPress();
assert.equal(calls.at(-1), "/applications/closed-job", "single press opens application");
nodes(rowTree)
	.find((node) => node.props.icon === "dots-three")
	.props.onPress();
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
const selectedRow = nodes(sectionList.props.renderItem({ item: applications[0] })).find(
	(node) => node.type === "ListRow",
);
assert.equal(selectedRow.props.leading, "check-square", "ellipsis keeps explicit bulk selection reachable");
console.log(
	"PASS Applications empty/create, closed-only reveal, filter reset, single press and explicit bulk selection entry",
);

// ApplicationsViewFrame owns Save job in place on every view; setParams keeps the current route and clears on close.
let createParam = "1";
const setParamsCalls = [];
const frameRouter = { ...router, setParams: (params) => setParamsCalls.push(params) };
const { ApplicationsViewFrame } = load("features/applications-board/views.tsx", {
	"expo-router": {
		useRouter: () => frameRouter,
		useLocalSearchParams: () => (createParam === "1" ? { create: "1" } : {}),
		Stack: { Screen: "StackScreen" },
	},
	"react-native-safe-area-context": {
		SafeAreaView: "SafeAreaView",
		SafeAreaInsetsContext: { Provider: "Provider" },
		useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
	},
	"@/components/collection-header": { CollectionHeader: "CollectionHeader" },
	"./search": { useApplicationSearch: () => ({ search: "", setSearch() {} }) },
	"@/features/applications/add-sheet": { AddApplicationSheet: "AddApplicationSheet" },
	"@/features/applications/lane-notice": { LaneNotice: "LaneNotice" },
	"@/features/applications/lane-settings": { LaneSettings: "LaneSettings" },
});
const openFromHeader = (tree) => {
	const header = nodes(tree).find((node) => node.type === "CollectionHeader");
	assert.ok(header, "Applications header is present");
	const save = nodes(header.props.actions).find((node) => node.props.label === "Save a job");
	assert.ok(save, "Save job is in the Applications header on every view");
	save.props.onPress();
};
for (const view of ["list", "board", "calendar", "insights"]) {
	reset();
	createParam = "1";
	let tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	let sheet = nodes(tree).find((node) => node.type === "AddApplicationSheet");
	assert.ok(sheet, `${view}: ?create opens Save job in place`);
	sheet.props.onClose();
	assert.deepEqual(setParamsCalls.at(-1), { create: "" }, `${view}: close clears create without leaving the view`);
	createParam = "";
	setParamsCalls.length = 0;
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	assert.ok(!nodes(tree).some((node) => node.type === "AddApplicationSheet"));
	openFromHeader(tree);
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	sheet = nodes(tree).find((node) => node.type === "AddApplicationSheet");
	assert.ok(sheet, `${view}: New opens Save job`);
	sheet.props.onClose();
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	openFromHeader(tree);
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	assert.ok(
		nodes(tree).some((node) => node.type === "AddApplicationSheet"),
		`${view}: Save job opens again after cancel`,
	);
}
console.log("PASS Applications views own in-place Save job with repeat/cancel and no back stack");

// New routes in place on every Applications view, but pushes the list from a workspace and the context sheet elsewhere.
let pathname = "/applications/board";
const newCalls = [];
const newRouter = {
	push: (href) => newCalls.push({ kind: "push", href }),
	setParams: (params) => newCalls.push({ kind: "setParams", params }),
};
const { useNewAction: createNewAction } = load("shell/use-new-action.ts", {
	"expo-router": { useRouter: () => newRouter, usePathname: () => pathname },
	"@/routes": { routes },
});
for (const view of ["/applications", "/applications/board", "/applications/calendar", "/applications/insights"]) {
	pathname = view;
	newCalls.length = 0;
	createNewAction()();
	assert.deepEqual(newCalls, [{ kind: "setParams", params: { create: "1" } }], `${view}: stays in place`);
}
pathname = "/applications/application-1/apply";
newCalls.length = 0;
createNewAction()();
assert.deepEqual(newCalls, [{ kind: "push", href: "/applications?create=1" }], "workspace pushes the list once");
pathname = "/career/today";
newCalls.length = 0;
createNewAction()();
assert.deepEqual(newCalls, [{ kind: "push", href: "/new?context=career" }], "Career leads its New sheet");
pathname = "/documents";
newCalls.length = 0;
createNewAction()();
assert.deepEqual(newCalls, [{ kind: "push", href: "/new" }], "Documents keeps New document");
console.log("PASS native New preserves Applications views, pushes from a workspace and follows Career/Documents");

// Opening earlier applications must preserve an unsaved job until explicit discard.
let finishSave;
const { AddApplicationSheet } = load("features/applications/add-sheet.tsx", {
	react: { ...react, useEffect: () => {} },
	"@orpc/client": { ORPCError: class extends Error {} },
	"@tanstack/react-query": { useQuery: (options) => ({ data: options.queryKey[0] === "posting-match" ? null : [] }) },
	"./date": { parseDateOnly: () => new Date() },
	"./error": { applicationError: String },
	"./lane-notice": { LaneNotice: "LaneNotice" },
	"./lane-queries": laneQuery,
	"./lanes": lanes,
	"./prior-no-response": { PriorNoResponse: "PriorNoResponse" },
	"./queries": {
		useApplicationMutations: () => ({
			create: {
				mutateAsync: () =>
					new Promise((resolve) => {
						finishSave = resolve;
					}),
			},
		}),
	},
	"./stages": stages,
	"@/api/client": {
		client: {},
		orpc: {
			applications: { findPosting: { queryOptions: () => ({ queryKey: ["posting-match"] }) } },
			documents: { list: { queryOptions: () => ({ queryKey: ["documents"] }) } },
			webAccess: { status: { queryOptions: () => ({ queryKey: ["web"] }) } },
		},
	},
	"@/auth/session": {
		getServer: () => "test",
		getAccountScope: () => "test:alice",
		useSession: () => ({ server: "test" }),
	},
	"@/features/ai/providers": {
		AIProviderSetupSheet: "AIProviderSetupSheet",
		useHasAIProvider: () => ({ hasAIProvider: false }),
	},
	"@/features/application-detail/date-field": { WallClockField: "WallClockField" },
	"@/routes": { routes: { ...routes, applicationDetails: (id) => `/applications/${id}` } },
	"@/ui": { ...ui, EditorSheet: "EditorSheet" },
});
reset();
const addView = () => render(AddApplicationSheet, { onClose: () => calls.push("close-draft") });
control(addView(), "Fill details manually").onPress();
control(addView(), "Company").onChangeText("Fictional Labs");
control(addView(), "Role / title").onChangeText("Engineer");
const priorLink = () => nodes(addView()).find((node) => node.type === "PriorNoResponse").props;
const discardPrior = () =>
	nodes(addView()).find(
		(node) => node.type === "ConfirmDialog" && node.props.message.includes("opening this application"),
	).props;
assert.equal(priorLink().onOpen("previous"), false);
assert.deepEqual(calls, [], "opening the warning cannot discard or navigate yet");
assert.equal(discardPrior().open, true);
discardPrior().onCancel();
assert.equal(control(addView(), "Company").value, "Fictional Labs", "Keep editing retains draft");
// Footer is a separate prop in the host renderer.
const footer = nodes(addView()).find((node) => node.type === "EditorSheet").props.footer;
control(footer, "Save job").onPress();
assert.equal(priorLink().disabled, true, "warning cannot interrupt an in-flight save");
priorLink().onOpen("previous");
assert.equal(discardPrior().open, false);
finishSave("saved");
await settle();
assert.deepEqual(calls, ["close-draft", "/applications/saved"]);
reset();
control(addView(), "Fill details manually").onPress();
control(addView(), "Company").onChangeText("Fictional Labs");
priorLink().onOpen("previous");
discardPrior().onConfirm();
assert.deepEqual(calls, ["close-draft", "/applications/previous"], "explicit discard opens the prior application");
console.log("PASS native prior-application draft confirmation and save lock");

// Default calendar month/day follows the account clock; explicit navigation remains pinned.
const calendarSchedule = load("features/reminders/schedule.ts", { "@reactive-resume/utils/timezone": {} });
const nativeCalendar = load("features/applications-board/calendar.ts", {
	"../reminders/schedule.ts": calendarSchedule,
});
const calendarTokens = load("ui/tokens.ts", { "react-native": { Easing: { bezier: () => null } } });
let calendarNow = new Date("2026-10-31T22:59:30Z");
const calendarRows = [
	{
		id: "calendar-application",
		company: "Fictional Labs",
		role: "Engineer",
		status: "interview",
		activity: ["2026-10-31T22:30:00Z", "2026-11-01T09:00:00Z", "2026-11-04T14:00:00Z"].map((at, index) => ({
			id: `calendar-${index}`,
			type: "interview",
			at,
			durationMinutes: 60,
			kind: "technical",
			timezone: "UTC",
		})),
	},
];
const { CalendarScreen } = load("features/applications-board/calendar-screen.tsx", {
	"react-native": { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", RefreshControl: "RefreshControl" },
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-GB" } }) },
	"@lingui/core/macro": {
		plural: (value, forms) => (forms[value] ?? forms[value === 1 ? "one" : "other"]).replace("#", String(value)),
	},
	"./calendar": nativeCalendar,
	"./search": { useApplicationSearch: () => ({ search: "" }) },
	"./views": { ApplicationsViewFrame: "ApplicationsViewFrame" },
	"@/features/application-detail/hooks": {
		useNow: () => calendarNow,
		useUserTime: () => ({ timeZone: "Europe/Berlin", time: () => "" }),
		interviewTypeLabel: (kind) => kind,
	},
	"@/features/application-detail/interview-sheet": { InterviewSheet: "InterviewSheet" },
	"@/features/application-detail/sheets": { FollowUpSheet: "FollowUpSheet" },
	"@/features/applications/error": { applicationError: () => "offline" },
	"@/features/applications/list": { filterApplications: (rows) => rows },
	"@/features/applications/queries": {
		useApplications: () => ({ data: calendarRows, isError: false, isPending: false, refetch() {} }),
	},
	"@/shell/use-is-tablet": { useIsTablet: () => false },
	"@/ui": {
		...ui,
		EmptyState: "EmptyState",
		Sheet: "Sheet",
		useTheme: () => ({ ...calendarTokens, colors: calendarTokens.colors.light }),
	},
});
const calendarComponent = nodes(CalendarScreen()).find((node) => typeof node.type === "function").type;
reset();
const calendarView = () => render(calendarComponent);
const calendarHeading = () => nodes(calendarView()).find((node) => node.props.variant === "heading").props.children[0];
const calendarText = () =>
	nodes(calendarView())
		.flatMap((node) => node.props.children.flat(Infinity))
		.filter((child) => typeof child === "string");
assert.equal(calendarHeading(), "October 2026");
assert.ok(calendarText().includes("1 interview"));
calendarNow = new Date("2026-10-31T23:00:30Z");
assert.equal(calendarHeading(), "November 2026");
assert.ok(calendarText().includes("2 interviews"));
assert.ok(calendarText().includes("Today"), "unselected day follows account-local midnight");
control(calendarView(), "Previous month").onPress();
calendarNow = new Date("2026-11-30T23:00:30Z");
assert.equal(calendarHeading(), "October 2026", "explicit month survives account-month rollover");
control(calendarView(), "This month").onPress();
assert.equal(calendarHeading(), "December 2026");
calendarNow = new Date("2026-12-31T23:00:30Z");
assert.equal(calendarHeading(), "January 2027", "This month restores following the account clock");
const selectedCalendarDay = new Intl.DateTimeFormat("en-GB", {
	timeZone: "UTC",
	weekday: "long",
	day: "numeric",
	month: "long",
}).format(new Date("2027-01-04T00:00:00Z"));
const dayChoice = nodes(calendarView()).find(
	(node) => node.type === "Pressable" && node.props.accessibilityLabel === selectedCalendarDay,
);
assert.ok(dayChoice);
dayChoice.props.onPress();
calendarNow = new Date("2027-01-31T23:00:30Z");
assert.equal(calendarHeading(), "January 2027", "choosing a day pins its displayed month");
assert.ok(calendarText().includes(selectedCalendarDay), "chosen day survives account-local rollover");
assert.equal(control(calendarView(), "This month").disabled, false);
control(calendarView(), "This month").onPress();
assert.equal(calendarHeading(), "February 2027");
assert.ok(calendarText().includes("Today"));
console.log("PASS native calendar follows account month/day and preserves explicit browsing");

// Manual offers use the production parser; only native widgets, transport and profile loading are boundaries.
const amountParser = load("../../../packages/utils/src/amount.ts");
const timeParser = load("../../../packages/utils/src/timezone.ts", { zod });
const careerSchema = load("../../../packages/schema/src/career.ts", {
	zod,
	"@reactive-resume/utils/region": { searchRegionsSchema: zod.z.array(zod.z.string()).nullable().optional() },
	"@reactive-resume/utils/timezone": timeParser,
});
const offerParser = load("../../../packages/schema/src/career-offer.ts", {
	"./career": careerSchema,
	"@reactive-resume/utils/amount": amountParser,
	"@reactive-resume/utils/timezone": timeParser,
});
let offerProfile = { isSuccess: false, isPending: true, isError: false };
let savedOffers = [
	{ createdAt: "2026-09-01T00:00:00Z", data: { kind: "offer", currency: "USD" } },
	{ createdAt: "2026-10-01T00:00:00Z", data: { kind: "offer", currency: "GBP" } },
];
let offerApplications = { data: [] };
const { OfferEntry } = load("features/career/offer-entry.tsx", {
	"@reactive-resume/schema/career": careerSchema,
	"@reactive-resume/schema/career-offer": offerParser,
	"./hooks": {
		useCareerTime: () => ({ locale: "en-US", timeZone: "Europe/Berlin", profile: offerProfile }),
		useCareerAction: () => ({
			pending: false,
			run: async (work, success) => {
				await work();
				success();
			},
		}),
		client: { career: { createOffer: async (input) => calls.push(input) } },
		useOffers: () => ({ data: savedOffers }),
	},
	"./shared": { EditorSheet: "EditorSheet", LoadState: "LoadState" },
	"@/features/application-detail/date-field": { WallClockField: "WallClockField" },
	"@/features/applications/queries": { useApplications: () => offerApplications },
});
reset();
offerApplications = { isPending: true };
assert.equal(render(OfferEntry, {}).type, "LoadState", "unknown metadata offers no ready action");
offerApplications = { isError: true };
assert.equal(render(OfferEntry, {}).type, "LoadState", "failed metadata stays retryable, not empty");
offerApplications = { data: [] };
// With no application to attach it to, Add offer leads to saving a job first.
control(render(OfferEntry, {}), "Add an application first").onPress();
assert.deepEqual(calls, ["/applications?create=1"]);
assert.ok(!nodes(render(OfferEntry, {})).some((node) => node.props.label === "Add offer"));
reset();
const entryView = () => render(OfferEntry, { application: { id: "job", company: "Fictional Labs", role: "Engineer" } });
control(entryView(), "Add offer").onPress();
const formElement = nodes(entryView()).find((node) => typeof node.type === "function");
assert.ok(formElement);
reset();
const offerView = () => render(formElement.type, { ...formElement.props, onClose() {} });
offerView();
assert.equal(control(offerView(), "Currency").value, "GBP", "starts in the last offer's currency");
savedOffers = [{ createdAt: "2026-11-01T00:00:00Z", data: { kind: "offer", currency: "EUR" } }];
assert.equal(control(offerView(), "Currency").value, "GBP", "late refetch cannot replace the draft currency");
assert.equal(control(offerView(), "Currency").placeholder, undefined, "no placeholder posing as a value");
assert.match(control(offerView(), "Currency").helper, /three-letter/);
assert.ok(!nodes(offerView()).some((node) => node.props.label === "Learning budget"), "rarer terms start folded");
assert.ok(!nodes(offerView()).some((node) => /Times are shown/.test(String(node.props.children))));
control(offerView(), "Currency").onChangeText("EUR");
control(offerView(), "More options").onPress();
control(offerView(), "Learning budget").onChangeText("95k");
assert.equal(control(offerView(), "Learning budget").error, undefined, "typing shows no premature error");
control(offerView(), "Learning budget").onBlur();
assert.match(control(offerView(), "Learning budget").error, /full amount/);
control(offerView(), "More options").onPress();
control(offerView(), "Save offer").onPress();
assert.equal(control(offerView(), "More options").expanded, true, "Save reveals invalid terms for correction");
assert.deepEqual(calls, [], "invalid optional learning cannot save");
assert.equal(control(offerView(), "Learning budget").value, "95k", "invalid draft remains editable");
control(offerView(), "Learning budget").onChangeText("");
control(offerView(), "Respond by").onChange("2027-03-28");
for (const state of ["loading", "failure"]) {
	offerProfile = { isSuccess: false, isPending: state === "loading", isError: state === "failure" };
	control(offerView(), "Save offer").onPress();
	assert.deepEqual(calls, [], `profile ${state} cannot silently discard deadline`);
	assert.ok(nodes(offerView()).some((node) => node.type === "Banner" && /account timezone/.test(node.props.message)));
	assert.equal(control(offerView(), "Respond by").value, "2027-03-28");
}
offerProfile = { isSuccess: true, isPending: false, isError: false };
assert.ok(nodes(offerView()).some((node) => /Times are shown in Europe\/Berlin/.test(String(node.props.children))));
control(offerView(), "Time").onChange("02:30");
control(offerView(), "Save offer").onPress();
assert.deepEqual(calls, [], "nonexistent local time cannot save");
control(offerView(), "Time").onChange("03:30");
control(offerView(), "Save offer").onPress();
await settle();
assert.equal(calls[0].respondBy, "2027-03-28T01:30:00.000Z");
assert.equal(calls[0].learning, null);
assert.equal(calls[0].base, null);
assert.equal(calls[0].currency, "EUR");
assert.equal(calls[0].period, "year");
calls.length = 0;
offerProfile = { isSuccess: false, isPending: false, isError: true };
control(offerView(), "Respond by").onChange("");
control(offerView(), "Save offer").onPress();
await settle();
assert.equal(calls[0].respondBy, null, "a genuinely blank deadline needs no loaded profile");
console.log("PASS native offer validation, draft preservation, profile loading/failure and blank deadline");

// Native Save must stay reachable for validation, then focus the actual missing input.
const { Stories } = load("features/career/stories.tsx", {
	"@reactive-resume/schema/career": careerSchema,
	"./hooks": {
		useCareerQueries: () => ({ stories: { data: [] }, facts: { data: [] } }),
		useUndoRows: () => ({ hidden: [] }),
		useCareerAction: () => ({ pending: false, run: (save) => save() }),
		client: { career: { saveStory: (payload) => calls.push({ story: payload }) } },
	},
	"./shared": { Actions: "Actions", EditorSheet: "EditorSheet", LoadState: "LoadState", SwitchRow: "SwitchRow" },
});
reset();
control(render(Stories, {}), "Add a story").onPress();
const storyEditor = nodes(render(Stories, {})).find(
	(node) => typeof node.type === "function" && node.props.story === null,
);
assert.ok(storyEditor, "Add a story opens the editor");
reset();
const storyView = () => render(storyEditor.type, storyEditor.props);
control(storyView(), "Title").onChangeText("Fictional setup repair");
control(storyView(), "Situation (required)").onChangeText("Customers could not finish setup.");
control(storyView(), "Action (required)").onChangeText("I repaired setup.");
control(storyView(), "Task (required)").onChangeText(" ");
const originalAnimationFrame = globalThis.requestAnimationFrame;
try {
	globalThis.requestAnimationFrame = (callback) => callback();
	assert.equal(control(storyView(), "Save story").disabled, false, "Missing parts cannot silently disable Save");
	control(storyView(), "Task (required)").ref({ focus: () => calls.push("focus-task") });
	control(storyView(), "Save story").onPress();
	assert.deepEqual(calls, ["focus-task"], "Invalid drafts focus Task without making a request");
	assert.equal(control(storyView(), "Task (required)").error, "Complete Task before saving.");
	assert.equal(control(storyView(), "Situation (required)").value, "Customers could not finish setup.");
	control(storyView(), "Task (required)").onChangeText("Restore setup.");
	control(storyView(), "Save story").onPress();
	assert.equal(calls.at(-1).story.result, "");
	assert.equal(calls.at(-1).story.reflection, "");
} finally {
	globalThis.requestAnimationFrame = originalAnimationFrame;
}
console.log("PASS native story validation focus, draft preservation and optional outcomes");

// Execute native custom-date controls against the real shared parser.
const dateModule = { exports: {} };
new Function(
	"require",
	"module",
	"exports",
	buildSync({
		entryPoints: [new URL("../../../packages/schema/src/resume/dates.ts", import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
)(serverRequire, dateModule, dateModule.exports);
const schemaDates = dateModule.exports;
const { DatesField } = load("features/write/date-field.tsx", {
	"react-native": { View: "View", Platform: { OS: "ios" } },
	"@react-native-community/datetimepicker": { default: "DateTimePicker" },
	"@reactive-resume/schema/resume/dates": schemaDates,
	"./dates": load("features/write/dates.ts", {
		"@reactive-resume/schema/resume/dates": schemaDates,
		"@reactive-resume/schema/resume/period": {},
	}),
	"@/draft": { resumeFieldFocus: { onFocus() {}, onBlur() {} } },
});
reset();
let dateValue = { start: "2022-03", end: null, present: true };
const dateView = () =>
	render(DatesField, {
		dates: dateValue,
		locale: "en-US",
		onChange: (next) => {
			dateValue = next;
		},
	});
control(dateView(), "Custom date text").onValueChange(true);
assert.equal(control(dateView(), "Dates").value, "Mar 2022 – Present");
control(dateView(), "Dates").onChangeText("During university / bis heute");
assert.deepEqual(dateValue, { start: null, end: null, present: false, raw: "During university / bis heute" });
assert.equal(control(dateView(), "Custom date text").disabled, true);
control(dateView(), "Dates").onBlur();
assert.equal(control(dateView(), "Dates").value, "During university / bis heute");
control(dateView(), "Dates").onChangeText("");
assert.equal(control(dateView(), "Custom date text").disabled, false);
control(dateView(), "Custom date text").onValueChange(false);
assert.deepEqual(dateValue, { start: null, end: null, present: false });
console.log("PASS native custom-date editing, saving, blur and safe return to date fields");

reset();
dateValue = { start: "2022-03", end: null, present: true };
const japaneseDateView = () =>
	render(DatesField, {
		dates: dateValue,
		locale: "ja-JP",
		onChange: (next) => {
			dateValue = next;
		},
	});
control(japaneseDateView(), "Custom date text").onValueChange(true);
assert.equal(control(japaneseDateView(), "Dates").value, "2022年3月 – 現在");
assert.equal(control(japaneseDateView(), "Custom date text").disabled, false);
control(japaneseDateView(), "Custom date text").onValueChange(false);
assert.deepEqual(dateValue, { start: "2022-03", end: null, present: true });
console.log("PASS native Japanese preset dates survive custom-mode round trip");

reset();
const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const sharedProposals = { exports: {} };
new Function(
	"require",
	"module",
	"exports",
	buildSync({
		entryPoints: [mobileRequire.resolve("@reactive-resume/resume/proposals")],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
)(mobileRequire, sharedProposals, sharedProposals.exports);
const { createDraftStore } = load("draft/store.ts", {
	"@reactive-resume/resume/proposals": sharedProposals.exports,
	immer: mobileRequire("immer"),
	zustand: mobileRequire("zustand"),
	"@reactive-resume/utils/string": { generateId: () => "photo-session" },
});
const photoUrl = "https://resume.example.test/api/uploads/owner/pictures/shared.jpeg";
const photoBytes = new Map([[photoUrl, "photo bytes"]]);
const photoData = { picture: { url: photoUrl, fit: "cover", size: 80 }, basics: { name: "Original" } };
const photoDraft = createDraftStore(
	{
		kind: "resume",
		delay: 500,
		read: async (id) => ({ id, isLocked: false, data: structuredClone(photoData) }),
		data: (document) => document.data,
		withData: (document, data) => ({ ...document, data }),
		version: () => 1,
		parse: (value) => value,
		matches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
	},
	{
		scope: async () => "photo-owner",
		online: () => false,
		focused: () => true,
		storage: { getItemSync: () => null, setItemSync() {}, removeItemSync() {}, getAllKeysSync: () => [] },
	},
);
await photoDraft.store.getState().open("original");
const photoStore = Object.assign((select) => select(photoDraft.store.getState()), {
	getState: photoDraft.store.getState,
});
const photoHooks = load("features/write/hooks.ts", {
	"@/draft": { useResumeStore: photoStore },
	"@reactive-resume/resume/section-sort": {},
	"./fields": {},
	"./model": {},
});
const { PictureScreen } = load("features/write/picture-screen.tsx", {
	"@tanstack/react-query": { useMutation: () => ({}) },
	"expo-file-system": {},
	"expo-image": { Image: "Image" },
	"expo-image-picker": {},
	"./entry-screen": { EditorScreen: "EditorScreen" },
	"./hooks": { ...photoHooks, useWriteData: (select) => select(photoStore.getState().data) },
	"./pickers": {},
	"./upload": {},
	"@/api/client": { client: { storage: { deleteFile: async () => photoBytes.delete(photoUrl) } } },
	"@/auth/session": { useSession: () => ({ server: "https://resume.example.test" }) },
	"@/draft": { useResumeStore: photoStore, useIsResumeLocked: () => photoStore.getState().locked },
	"@/draft/native": { nativeEnvironment: {} },
});
const photoView = () => render(PictureScreen);
// Undo removal must retain the edit immediately before it.
photoStore.getState().update((draft) => {
	draft.picture.size = 123;
});
control(photoView(), "Remove photo").onPress();
const photoConfirm = nodes(photoView()).find((node) => node.type === "ConfirmDialog" && node.props.open);
if (photoConfirm) photoConfirm.props.onConfirm();
assert.equal(photoStore.getState().data.picture.url, "");
assert.equal(photoBytes.get(photoUrl), "photo bytes");
assert.equal(
	nodes(photoView()).some((node) => node.type === "ConfirmDialog"),
	false,
);
const photoToast = calls.at(-1);
assert.equal(photoToast.action.label, "Undo");
photoStore.getState().update((draft) => {
	draft.basics.name = "Later edit";
});
photoToast.action.onPress();
assert.deepEqual(photoStore.getState().data.picture, { url: photoUrl, fit: "cover", size: 123 });
assert.equal(photoStore.getState().data.basics.name, "Later edit");
photoStore.getState().update((draft) => {
	draft.basics.name = "After restoration";
});
photoToast.action.onPress();
assert.equal(photoStore.getState().data.basics.name, "After restoration");

control(photoView(), "Remove photo").onPress();
const replacedPhotoToast = calls.at(-1);
photoStore.getState().update((draft) => {
	draft.picture.url = "https://photos.example.test/new.jpeg";
});
replacedPhotoToast.action.onPress();
assert.equal(photoStore.getState().data.picture.url, "https://photos.example.test/new.jpeg");

control(photoView(), "Remove photo").onPress();
const lockedPhotoToast = calls.at(-1);
photoDraft.store.setState({ locked: true });
lockedPhotoToast.action.onPress();
assert.equal(photoStore.getState().data.picture.url, "");
photoDraft.store.setState({ locked: false });
photoStore.getState().update((draft) => {
	draft.picture.url = photoUrl;
});
photoDraft.store.setState({ locked: true });
const toastCountBeforeLockedRemoval = calls.length;
control(photoView(), "Remove photo").onPress();
assert.equal(photoStore.getState().data.picture.url, photoUrl);
assert.equal(calls.length, toastCountBeforeLockedRemoval);

photoDraft.store.setState({ locked: false });
control(photoView(), "Remove photo").onPress();
const originalPhotoToast = calls.at(-1);
await photoStore.getState().open("other");
photoStore.getState().update((draft) => {
	draft.picture.url = "";
	draft.basics.name = "Other resume edit";
});
const otherPhotoData = photoStore.getState().data;
originalPhotoToast.action.onPress();
assert.deepEqual(photoStore.getState().data, otherPhotoData);
photoDraft.suspend();
console.log("PASS native photo removal preserves shared upload and Undo restores only removal");

// Actual native suggestion component callbacks; HTTP and platform sheets remain local boundaries.
reset();
let roleAiAvailable = false;
let roleAccount = "alice";
const roleRequests = [];
const usedRoles = [];
let roleReply = async () => ({
	suggestions: [
		{
			role: "Reliability engineer",
			facts: [{ id: "shared", text: "I maintain reliable services." }],
			resumeQuote: null,
		},
	],
});
const { RoleSuggestions } = load("features/career/role-suggestions.tsx", {
	"@tanstack/react-query": { useQuery: () => ({ isSuccess: true, data: [], refetch() {} }) },
	"./hooks": { useCareerAction: () => ({ pending: false, run: async (operation) => operation() }) },
	"./shared": { SwitchRow: "SwitchRow" },
	"@/api/client": {
		client: {
			career: {
				suggestTargetRoles: async (input) => {
					roleRequests.push(input);
					return roleReply();
				},
			},
		},
		orpc: { documents: { list: { queryOptions: () => ({ queryKey: ["documents"] }) } } },
	},
	"@/auth/session": {
		useSession: () => ({ status: "signed-in", server: "http://localhost:3076" }),
		getAccountScope: () => roleAccount,
	},
	"@/features/ai/providers": {
		useHasAIProvider: () => ({
			isUnavailable: false,
			hasAIProvider: roleAiAvailable,
			usableProviders: roleAiAvailable
				? [
						{
							id: "local",
							recipientVersion: "a".repeat(64),
							label: "Local fixture",
							provider: "openai-compatible",
							model: "stub",
						},
					]
				: [],
		}),
	},
	"@/features/workspace/hooks": { workspaceError: (_cause, fallback) => fallback },
});
const roleProps = { locale: "en-US", onUse: (roles) => usedRoles.push(roles) };
const roleView = () => render(RoleSuggestions, roleProps);
let roleTree = roleView();
control(roleTree, "Suggest target roles (optional AI)").onPress();
roleTree = roleView();
assert.match(JSON.stringify(roleTree), /keep entering roles manually/);
assert.equal(roleRequests.length, 0);
roleAiAvailable = true;
roleTree = roleView();
assert.equal(control(roleTree, "Generate role suggestions").disabled, true);
control(roleTree, "AI connection receiving your context").onChange("local");
roleTree = roleView();
assert.equal(control(roleTree, "Generate role suggestions").disabled, true, "context is explicit, never preselected");
control(roleTree, "Share enabled shared Knowledge").onValueChange(true);
roleTree = roleView();
control(roleTree, "Generate role suggestions").onPress();
await settle();
roleTree = roleView();
assert.equal(usedRoles.length, 0, "generation must never use a role automatically");
assert.deepEqual(roleRequests, [
	{ providerId: "local", recipientVersion: "a".repeat(64), resumeId: null, includeKnowledge: true, locale: "en-US" },
]);
control(roleTree, "Review target roles, one per line").onChangeText("Platform engineer");
roleTree = roleView();
control(roleTree, "Use reviewed roles in preferences").onPress();
assert.deepEqual(usedRoles, [["Platform engineer"]]);
// A result from a departing account may not populate the new account's draft.
let releaseRoles;
roleReply = () =>
	new Promise((resolve) => {
		releaseRoles = resolve;
	});
roleTree = roleView();
control(roleTree, "Generate role suggestions").onPress();
await settle();
roleAccount = "bob";
releaseRoles({ suggestions: [{ role: "Old account role", facts: [], resumeQuote: null }] });
await settle();
roleTree = roleView();
assert.equal(
	nodes(roleTree).some((node) => node.props.label === "Review target roles, one per line"),
	false,
);
console.log(
	"PASS native discovery role opt-ins, no-AI fallback, editable-before-use roles and cross-account response isolation",
);

reset();
const triageCalls = [];
let triageActive = 0;
let maxTriageActive = 0;
const discovered = ["Platform engineer", "Reliability engineer"].map((role, index) => ({
	id: `role-${index}`,
	role,
	company: "Fictional Labs",
	url: `https://example.test/jobs/${index}`,
	location: "",
	snippet: "Maintain reliable services.",
	matches: [],
	unknowns: ["salary", "office"],
	trackedApplicationId: null,
	firstSeenAt: new Date(),
	lastSeenAt: new Date(),
	discoverySource: null,
}));
const { TodayScreen } = load("features/career/today.tsx", {
	"expo-web-browser": { openBrowserAsync: async () => {} },
	"./hooks": {
		client: {
			career: {
				trackOpportunity: async ({ id }) => {
					triageCalls.push(id);
					triageActive++;
					maxTriageActive = Math.max(maxTriageActive, triageActive);
					await Promise.resolve();
					triageActive--;
					if (id === "role-1") throw new Error("Synthetic partial failure");
					return { applicationId: "saved-role-0" };
				},
			},
		},
		useCareerAction: () => ({ pending: false, run: async (operation) => operation(), refresh: async () => {} }),
		useCareerTime: () => ({ timeZone: "UTC", locale: "en-US", when: () => "31 Oct", profile: { refetch() {} } }),
		useNow: () => new Date(),
		useTodayQueries: () => ({
			schedules: { data: [] },
			opportunities: { data: discovered },
			notifications: { data: [] },
			briefings: { data: [] },
		}),
		useUndoRows: () => ({ hidden: [], remove() {} }),
	},
	"./schedule-sheet": { ScheduleSheet: "ScheduleSheet", scheduleTitle: (kind) => kind },
	"./scheduling": { collectInterviews: () => [], rollForward: (at) => at },
	"./shared": { Actions: "Actions", LoadState: "LoadState", Section: "Section", SwitchRow: "SwitchRow" },
	"@/features/applications/lane-queries": { useApplicationLanes: () => ({ lanes: [] }) },
	"@/features/applications/lanes": { getLaneLabel: () => "Saved", resolveLane: () => null },
	"@/features/applications/next-step": { getNextStep: () => ({ kind: "none" }) },
	"@/features/applications/queries": { useApplications: () => ({ data: [], refetch() {} }) },
});
let triageTree = render(TodayScreen);
control(triageTree, "Select all roles").onPress();
triageTree = render(TodayScreen);
control(triageTree, "Track selected").onPress();
await settle();
triageTree = render(TodayScreen);
assert.deepEqual(triageCalls, ["role-0", "role-1"]);
assert.equal(maxTriageActive, 1, "bulk writes must not flood the owner queue");
assert.equal(control(triageTree, "Select Reliability engineer").value, true, "failed role stays selected");
assert.equal(
	nodes(triageTree).some((node) => node.props.label === "Select Platform engineer"),
	false,
	"successful role leaves review queue",
);
assert.match(JSON.stringify(triageTree), /1 updated; 1 failed/);
console.log("PASS native discovery serial bulk triage, partial-failure selection and success suppression");

const { DraftConflictSheet } = load("draft/conflict-sheet.tsx", {
	"./runtime": {},
	"react-native": { ...mocks["react-native"], Modal: "Modal" },
	"react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
});
for (const kind of ["resume", "letter"]) {
	reset();
	const props = {
		open: true,
		kind,
		name: "Fictional document",
		locked: false,
		onResolve: async (choice) => calls.push(choice),
	};
	const ordinary = render(DraftConflictSheet, props);
	assert.ok(control(ordinary, "Keep mine"));
	const refused = render(DraftConflictSheet, { ...props, reason: "CURRENT_CLIENT_REQUIRED" });
	assert.equal(
		nodes(refused).some((node) => node.props.label === "Keep mine"),
		false,
	);
	assert.match(JSON.stringify(refused), /An older app kept these edits/);
	assert.doesNotMatch(JSON.stringify(refused), /saved on another device/);
	const locked = render(DraftConflictSheet, { ...props, locked: true });
	assert.match(JSON.stringify(locked), /Unlock it before keeping your edits here/);
	const lockedRefusal = render(DraftConflictSheet, { ...props, locked: true, reason: "CURRENT_CLIENT_REQUIRED" });
	assert.doesNotMatch(JSON.stringify(lockedRefusal), /Unlock it before keeping your edits here/);
	control(refused, "Keep both").onPress();
	await settle();
	assert.equal(calls.at(-1), "keep-both");
	control(refused, "Use saved version").onPress();
	const confirmed = render(DraftConflictSheet, { ...props, reason: "CURRENT_CLIENT_REQUIRED" });
	const dialog = nodes(confirmed).find((node) => node.type === "ConfirmDialog");
	assert.equal(dialog.props.open, true);
	dialog.props.onConfirm();
	await settle();
	assert.equal(calls.at(-1), "use-theirs");
}
console.log("PASS native older-draft refusal explains cause and offers only copy or saved-version recovery");
// Writing publishes the persisted query, never a completed mutation's discarded response.
reset();
let savedWriting = null;
let publishedWriting = null;
let resolveOld;
let resolveNew;
let writingRequest = 0;
const writingCleanup = [];
const queryKey = ({ input }) => ["writing", input.resumeId];
const { Writing } = load("features/check/writing.tsx", {
	react: {
		...react,
		useEffect: (effect) => {
			const cleanup = effect();
			if (cleanup) writingCleanup.push(cleanup);
		},
	},
	"@tanstack/react-query": {
		useQuery: () => ({ data: savedWriting }),
		useQueryClient: () => ({ invalidateQueries: async (options) => calls.push(options.queryKey) }),
	},
	"@reactive-resume/resume/markdown": { buildMarkdown: () => "Fictional original" },
	"@reactive-resume/resume/proposals": {
		collectPassages: () => [{ id: "p1", location: "Summary", text: "Fictional original" }],
	},
	"./actions": {},
	"./issues": { getSectionName: () => "Summary" },
	"./review": { mapWritingReview: () => ({ proposals: [], notes: [] }) },
	"@/draft": { useResumeStore: (select) => select({ proposalApplications: {} }) },
	"@/api/client": {
		client: {
			ai: {
				atsReview: () =>
					new Promise((resolve) => {
						if (++writingRequest === 1) resolveOld = resolve;
						else resolveNew = resolve;
					}),
			},
		},
		orpc: { ai: { writingReview: { queryOptions: queryKey, queryKey } } },
	},
	"@/features/ai/providers": {
		AIProviderSetupSheet: "Setup",
		useHasAIProvider: () => ({
			usableProviders: [{ id: "provider" }],
			defaultProvider: { id: "provider" },
			hasAIProvider: true,
		}),
	},
	"@/features/ai/report-content": { ReportAiContent: "Report" },
});
const writingProps = {
	id: "resume-a",
	data: {},
	issues: [],
	offline: false,
	locked: false,
	review: null,
	setReview: (value) => {
		publishedWriting = value;
	},
};
control(render(Writing, writingProps), "Review writing").onPress();
await settle();
for (const cleanup of writingCleanup.splice(0)) cleanup();
reset();
control(render(Writing, writingProps), "Review writing").onPress();
await settle();
resolveNew({ summary: "Unsaved response" });
await settle();
assert.equal(publishedWriting, null, "Mutation results cannot manufacture a published review");
savedWriting = {
	inputText: "Fictional original",
	passages: [],
	review: { summary: "Latest saved", strengths: [], suggestions: [] },
	reviewedAt: new Date("2030-01-01T00:00:02Z"),
};
render(Writing, writingProps);
assert.equal(publishedWriting.summary, "Latest saved");
resolveOld({ summary: "Older discarded response" });
await settle();
assert.equal(publishedWriting.summary, "Latest saved");
assert.deepEqual(
	calls,
	[["writing", "resume-a"]],
	"An unmounted canceled request cannot publish or invalidate a different document",
);
console.log("PASS native Writing authoritative publication and unmounted request order");

reset();
let linkedResume;
const { FitTab } = load("features/workspace/tabs/fit.tsx", {
	"@tanstack/react-query": {
		useQuery: (options) =>
			options.kind === "evidence"
				? { data: { usable: false } }
				: { data: [{ id: "chosen", type: "resume", name: "Chosen fictional resume" }] },
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
		useMutation: () => ({
			mutate: (input) => {
				linkedResume = input.resumeId;
			},
		}),
	},
	"expo-crypto": {},
	"../hooks": {
		useSavedItems: () => ({ data: [] }),
		useWorkspace: () => ({ data: {} }),
		useGenerate: () => ({ run: () => assert.fail("No evidence cannot generate") }),
		useFacts: () => ({ data: [] }),
		latest: () => undefined,
	},
	"../parts": {
		EmptyNotice: "EmptyNotice",
		AiNotice: "AiNotice",
		useWorking: (_pending, _steps, label) => label,
		workingSteps: () => [],
	},
	"../shell": { WorkspaceScreen: "WorkspaceScreen" },
	"@/api/client": {
		orpc: {
			career: {
				fitEvidence: { queryOptions: () => ({ kind: "evidence" }) },
				forgetFact: { mutationOptions: () => ({}) },
			},
			documents: { list: { queryOptions: () => ({ kind: "documents" }) } },
			applications: { update: { mutationOptions: () => ({}) } },
		},
	},
	"@/features/ai/providers": { useHasAIProvider: () => ({ defaultProvider: { id: "provider" } }) },
});
const fitProps = { application: { id: "app" } };
const fitComponent = FitTab().props.children[0](fitProps).type;
let fitTree = render(fitComponent, fitProps);
assert.equal(control(fitTree, "Check fit").disabled, true);
assert.ok(control(fitTree, "Add facts"));
control(fitTree, "Resume to use as evidence").onChange("chosen");
fitTree = render(fitComponent, fitProps);
control(fitTree, "Use this resume as evidence").onPress();
assert.equal(linkedResume, "chosen", "Fit links only the user's explicit resume choice");
console.log("PASS native Fit uses filtered evidence and explicit resume selection");

// Exercise the shipped preparation form, including setup visibility and retry callbacks.
let scheduleAi;
let scheduleRetries = 0;
const scheduleHooks = {
	useCareerTime: () => ({ profile: { data: { emailVerified: true } }, timeZone: "UTC", locale: "en-US" }),
	useCareerQueries: () => ({ profile: { data: { targetRoles: [], locations: [] } } }),
	useCareerAction: () => ({ pending: false }),
	useNow: () => new Date("2026-10-31T12:00:00Z"),
};
const { ScheduleSheet } = load("features/career/schedule-sheet.tsx", {
	"@react-native-community/datetimepicker": { default: "DateTimePicker" },
	"@tanstack/react-query": { useQuery: () => ({ data: { search: true, provider: null } }) },
	"@reactive-resume/schema/career": {},
	"@reactive-resume/utils/timezone": { fromZonedDateTime: () => new Date("2026-11-02T12:00:00Z") },
	"./hooks": scheduleHooks,
	"./scheduling": {
		collectInterviews: () => [],
		nextCareerRun: () => new Date("2026-11-02T12:00:00Z"),
		toZoned: () => ({ date: "2026-11-02", time: "12:00" }),
	},
	"./shared": { EditorSheet: "EditorSheet", SwitchRow: "SwitchRow" },
	"@/api/client": { orpc: { webAccess: { status: { queryOptions: () => ({}), key: () => [] } } } },
	"@/api/flags": { useFlags: () => ({ data: { careerSchedulingEnabled: true } }) },
	"@/auth/session": { useSession: () => ({ status: "signed-in", server: "https://fictional.example" }) },
	"@/features/ai/providers": { useHasAIProvider: () => scheduleAi },
	"@/features/ai/web-access": {},
	"@/features/applications/queries": { useApplications: () => ({ data: [] }) },
});
for (const state of ["loading", "error", "empty", "configured"]) {
	reset();
	const provider = { id: "fictional", label: "Fictional connection" };
	scheduleAi = {
		isLoading: state === "loading",
		isUnavailable: state === "loading" || state === "error",
		error: state === "error" ? new Error("Offline") : null,
		usableProviders: state === "configured" ? [provider] : [],
		defaultProvider: state === "configured" ? provider : null,
		hasAIProvider: state === "configured",
		retry: () => scheduleRetries++,
	};
	const form = render(ScheduleSheet, { schedule: null, kind: "prepare", onClose() {}, onDelete() {} });
	const formTree = render(form.type, form.props);
	assert.equal(
		nodes(formTree).some((node) => node.props.label === "Connect AI provider"),
		state === "empty" || state === "configured",
		`Setup availability for ${state}`,
	);
	if (state === "error") control(formTree, "Retry AI connections").onPress();
	if (state === "configured") assert.equal(control(formTree, "AI connection").value, provider.id);
}
assert.equal(scheduleRetries, 1);
console.log("PASS native preparation distinguishes loading/error from empty/configured AI lookup");
