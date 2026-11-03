// Shipped component actions run against native/export/network boundaries; no real account or outbound sharing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
// Lingui's t: a tagged template, or a descriptor ({ message, comment }) for strings with translator notes.
const tag = (parts, ...values) =>
	Array.isArray(parts)
		? parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "")
		: (parts?.message ?? "");
let hooks = [];
let cursor = 0;
const react = {
	createElement: element,
	useMemo: (make) => make(),
	useCallback: (fn) => fn,
	useImperativeHandle(ref, make) {
		if (ref) ref.current = make();
	},
	useEffect() {},
	useState(initial) {
		const index = cursor++;
		if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
		const owner = hooks;
		return [owner[index], (value) => (owner[index] = typeof value === "function" ? value(owner[index]) : value)];
	},
	useRef(initial) {
		const [value] = react.useState(() => ({ current: initial }));
		return value;
	},
};
const calls = [];
let searchParams = {};
let triageBindings = [];
let triageEligible = true;
const routes = {
	builder: (id, tab) => `/builder/${id}/${tab}`,
	application: (id, tab) => `/applications/${id}/${tab}`,
	applications: (view = "list") => (view === "list" ? "/applications" : `/applications/${view}`),
	new: (context = "documents") => (context === "documents" ? "/new" : `/new?context=${context}`),
	newJob: () => "/applications?create=1",
	career: (pane = "today") => `/career/${pane}`,
};
const router = {
	push: (href) => calls.push(href),
	setParams: (params) => {
		searchParams = { ...searchParams, ...params };
		calls.push({ params });
	},
	back() {},
};
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
		"Chip",
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
ui.useReducedMotion = () => false;
const mocks = {
	"@/shell/shortcut-help": {
		ShortcutHelpButton: "ShortcutHelpButton",
		CharacterShortcutSetting: "CharacterShortcutSetting",
		useShortcutHelp: { getState: () => ({ show() {} }) },
	},
	react,
	"react-native": { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Platform: { OS: "android" } },
	"expo-router": {
		useRouter: () => router,
		useLocalSearchParams: () => searchParams,
		Stack: { Screen: "StackScreen" },
	},
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-US" } }) },
	"@lingui/core/macro": { t: tag, plural: (value, forms) => forms.other.replace("#", String(value)) },
	"@reactive-resume/ai/task-models": {
		aiModelForTask: (provider, task) =>
			(task === "capable" ? provider.capableModel : provider.fastModel) ?? provider.model,
		aiTaskForOperation: () => undefined,
		aiConfiguredModels: (provider) => [
			...new Set([provider.model, provider.fastModel, provider.capableModel].filter(Boolean)),
		],
	},
	"@/routes": { routes },
	"@/features/ai/web-access": { WebAccessAttention: "WebAccessAttention" },
	"@/features/documents/tag-suggestions": { useExistingTags: () => [] },
	"@/ui": ui,
	"@/shell/key-commands": {
		supportsUnmodifiedCommands: true,
		useKeyCommands: (bindings) => {
			triageBindings = bindings;
		},
		useRegisteredKeyCommands: () => (triageEligible ? triageBindings : []),
	},
	"@/lib/undone": { confirmUndone: () => calls.push({ message: "Restored", duration: 1500 }) },
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
	const tree = component(props);
	return tree?.type?.name === "ScopedOfferEntry" ? tree.type(tree.props) : tree;
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
	"@/auth/session": {},
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
const fileNames = load("../../../packages/utils/src/file.ts", {
	"./file-name-words.json": JSON.parse(
		readFileSync(new URL("../../../packages/utils/src/file-name-words.json", import.meta.url), "utf8"),
	),
	"./slug": { slugify: (value) => value },
});
const { DownloadTab } = load("features/share/download.tsx", {
	"@reactive-resume/utils/file": fileNames,
	"@/features/applications/queries": { useApplications: () => ({ data: [] }) },
	"expo-web-browser": { openBrowserAsync: async (url) => calls.push({ browser: url }) },
	"@reactive-resume/resume/ats": { lintResumeForAts: () => ({ findings: [] }) },
	"@reactive-resume/resume/cover-letter": {},
	"./document": document,
	"./files": exportBoundary,
	"./letter": {},
	"./model": { safeFileName },
	"@/api/client": { client: {} },
	"@/draft": draftBoundary,
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
assert.equal(control(tree, "File name").value, "Alex-Example-Resume");
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
assert.equal(calls.find((call) => call?.export).export.name, "Alex-Example-Resume");
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
const zod = createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod");
const timeParser = load("../../../packages/utils/src/timezone.ts", { zod });
const followUpDomain = load("../../../packages/schema/src/applications/follow-up.ts", {
	"@reactive-resume/utils/timezone": timeParser,
});
mocks["@reactive-resume/schema/applications/follow-up"] = followUpDomain;
const domainNextStep = load("../../../packages/schema/src/applications/next-step.ts", {
	"./follow-up": followUpDomain,
	"./data": load("../../../packages/schema/src/applications/data.ts", {
		zod,
		"@reactive-resume/utils/timezone": timeParser,
	}),
});
mocks["@reactive-resume/schema/applications/next-step"] = domainNextStep;
mocks["@reactive-resume/schema/applications/upcoming"] = load("../../../packages/schema/src/applications/upcoming.ts", {
	"./follow-up": followUpDomain,
});
const history = load("features/applications/history.ts", {
	"@reactive-resume/schema/applications/next-step": domainNextStep,
});

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
// Offer hints for Next step: none known unless a case sets them.
let offerHint;
const stageActionsStub = {
	useOfferHints: () => undefined,
	offerHintFor: () => offerHint,
	useStageMovedToast: () => (moved, lane) => calls.push({ moved: moved.id, lane: lane.category }),
	acceptedStage: () => null,
};
const nextSteps = load("features/applications/next-step.ts", {
	"@reactive-resume/schema/applications/next-step": domainNextStep,
	"./stages": stages,
	"./history": history,
});
const time = { locale: "en-US", timeZone: "UTC", when: String, time: String, day: String, utcDay: String };
const outcomesDomain = load("../../../packages/schema/src/applications/outcomes.ts");
const suggestionsDomain = load("../../../packages/schema/src/applications/document-suggestions.ts");
const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const nativeIcs = load("features/reminders/ics.ts", {
	"@reactive-resume/utils/ics": mobileRequire("@reactive-resume/utils/ics"),
	"@reactive-resume/schema/applications/calendar": mobileRequire("@reactive-resume/schema/applications/calendar"),
});
let interviewScope = "fixture";
const reminderSchedule = load("features/reminders/schedule.ts", {
	"@reactive-resume/utils/timezone": mobileRequire("@reactive-resume/utils/timezone"),
});
const calendarBoundary = {
	...nativeIcs,
	zonedParts: reminderSchedule.zonedParts,
	shareIcs: async (event, file, method) => calls.push({ event, file, method }),
};
const nativeInterviewCalendar = load("features/application-detail/calendar.ts", {
	"@/auth/session": { getAccountScope: () => interviewScope },
	"@/features/reminders": calendarBoundary,
});
let applicationDocuments = [];
let rejectDocumentLink = false;
let creatingApplicationLetter = false;
const { StageStepper, NextStepCard, WhatYouSent } = load("features/application-detail/sections.tsx", {
	"@reactive-resume/schema/applications/outcomes": outcomesDomain,
	"@reactive-resume/schema/applications/document-suggestions": suggestionsDomain,
	"@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => {} }) },
	"expo-document-picker": {},
	"expo-file-system": {},
	"expo-sqlite/kv-store": {},
	"expo-web-browser": {},
	"./attachment": {},
	"./attachment-preview": { AttachmentPreview: "AttachmentPreview" },
	"./notes-queue": { createNotesQueue: () => ({}) },
	"./hooks": {
		useDocuments: () => ({ data: applicationDocuments }),
		useDetailMutations: () => ({ createLetter: { isPending: creatingApplicationLetter } }),
		useNow: () => new Date(),
		useUserTime: () => time,
		followUpReminder: () => null,
		interviewReminder: () => null,
	},
	"./sheets": { FollowUpSheet: "FollowUpSheet", ReminderSheet: "ReminderSheet" },
	"@/api/client": {
		client: {
			documents: {
				linkApplication: async (input) => {
					calls.push({ documentLink: input });
					if (rejectDocumentLink) throw new Error("Unavailable");
				},
			},
		},
		orpc: { applications: { key: () => ["applications"] }, documents: { key: () => ["documents"] } },
	},
	"@/auth/session": {},
	"@/draft": {},
	"@/features/applications/error": { applicationError: () => "Link unavailable" },
	"@/features/applications/history": history,
	"@/features/applications/lane-notice": { LaneNotice: "LaneNotice" },
	"@/features/applications/lane-queries": laneQuery,
	"@/features/applications/lanes": lanes,
	"@/features/applications/next-step": nextSteps,
	"@/features/applications/stage-actions": stageActionsStub,
	"@/features/applications/stages": stages,
	"@/features/applications/queries": {
		useApplicationMutations: () => ({ update: { isPending: false, mutate: (input) => calls.push(input) } }),
	},
	"./calendar": nativeInterviewCalendar,
	"@/features/reminders": {
		...nativeIcs,
		zonedParts: () => ({ date: "2026-11-01" }),
		shareIcs: async (event, file) => calls.push({ event, file }),
	},
	"@/features/share/files": {},
});
const application = {
	id: "job-a",
	company: "Fictional Cedar",
	status: "saved",
	activity: [],
	appliedAt: new Date().toISOString(),
	followUpAt: null,
	resumeId: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
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

reset();
const suggestedResume = {
	id: "existing-resume",
	type: "resume",
	name: "Fictional Cedar — Portfolio",
	isLocked: false,
	trashedAt: null,
	application: null,
	updatedAt: new Date("2026-11-01T12:00:00Z"),
};
const suggestedLetter = { ...suggestedResume, id: "existing-letter", type: "letter", name: "Fictional Cedar — Letter" };
applicationDocuments = [suggestedResume, suggestedLetter];
tree = render(WhatYouSent, { application });
rejectDocumentLink = true;
control(tree, "Use Fictional Cedar — Portfolio · Resume").onPress();
tree = render(WhatYouSent, { application });
assert.equal(
	control(tree, "Use Fictional Cedar — Letter · Cover letter").disabled,
	true,
	"Pending links disable peer suggestions",
);
assert.equal(control(tree, "Prepare a resume").disabled, true);
assert.equal(control(tree, "Write a letter").disabled, true);
await settle();
tree = render(WhatYouSent, { application });
assert.ok(calls.some((call) => call?.message === "Link unavailable"));
assert.equal(
	control(tree, "Use Fictional Cedar — Portfolio · Resume").disabled,
	false,
	"Failed links retain a retry action",
);
rejectDocumentLink = false;
control(tree, "Use Fictional Cedar — Portfolio · Resume").onPress();
await settle();
assert.deepEqual(calls.filter((call) => call?.documentLink).at(-1).documentLink, {
	type: "resume",
	id: "existing-resume",
	applicationId: "job-a",
	expectedUpdatedAt: suggestedResume.updatedAt,
});
tree = render(WhatYouSent, { application });
control(tree, "Use Fictional Cedar — Letter · Cover letter").onPress();
await settle();
assert.deepEqual(calls.filter((call) => call?.documentLink).at(-1).documentLink, {
	type: "letter",
	id: "existing-letter",
	applicationId: "job-a",
});
creatingApplicationLetter = true;
tree = render(WhatYouSent, { application });
assert.equal(control(tree, "Use Fictional Cedar — Portfolio · Resume").disabled, true);
assert.equal(control(tree, "Use an existing letter").disabled, true);
creatingApplicationLetter = false;
applicationDocuments = [];
console.log("PASS native company-matched resume/letter selection, revision guard, pending state and failed-link retry");

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
// J2-17: at Offer, Next step asks for the offer's terms (opening the form), then compares once they're saved.
const atOffer = {
	...application,
	status: "offer",
	activity: [{ id: "earlier", type: "interview", kind: "behavioral", at: "2099-01-01T12:00:00Z", durationMinutes: 60 }],
};
offerHint = null;
reset();
tree = render(NextStepCard, { application: atOffer, onOpenInterview() {} });
control(tree, "Add the offer's terms").onPress();
assert.deepEqual(calls.at(-1), { pathname: "/applications/job-a/messages", params: { offer: "new" } });
offerHint = { respondBy: null };
reset();
tree = render(NextStepCard, { application: atOffer, onOpenInterview() {} });
control(tree, "Compare offers").onPress();
assert.equal(calls.at(-1), "/career/offers");
offerHint = { respondBy: "2026-11-02T01:00:00Z" };
reset();
tree = render(NextStepCard, { application: atOffer, onOpenInterview() {} });
control(tree, "Add to calendar").onPress();
await settle();
assert.equal(calls[0].event.uid, "offer-job-a");
assert.equal(calls[0].event.start.toISOString(), new Date(offerHint.respondBy).toISOString());
assert.ok(calls[0].file.endsWith("2026-11-01.ics"), "calendar filename uses account day");
offerHint = undefined;
console.log(
	"PASS file-first sharing, single-flight/current-document/offline PDF export, fallback, explicit stage edits and state-aware next actions",
);

// Real interview form and calendar mapper; network, notifications, clock and system sharing stay at boundaries.
let savedInterviewInput;
let reminderOutcome;
let saveInterviewError = false;
let deleteInterviewError = false;
let switchDuringSave = false;
let switchDuringDelete = false;
let reminderOffError = false;
const nativeRound = {
	id: "native-original-round",
	type: "interview",
	at: "2027-03-27T10:00:00Z",
	kind: "technical",
	durationMinutes: 60,
	location: "Fictional office",
	notes: "Portfolio",
	timezone: "Europe/Berlin",
	audience: "other",
	participants: [{ name: "Maya Example", role: "Lead" }],
};
const nativeJob = { ...application, role: "Engineer", activity: [nativeRound] };
const nativeQueryClient = {
	setQueryData: (_key, update) => calls.push({ cachedActivity: update(nativeJob).activity }),
};
const nativeReminders = {
	leadFor: () => 30,
	turnOn: async () => {
		if (reminderOutcome instanceof Error) throw reminderOutcome;
		return reminderOutcome;
	},
	turnOff: async () => {
		calls.push("reminder-off");
		if (reminderOffError) throw new Error("Reminder unavailable");
	},
};
const { InterviewSheet: NativeInterviewSheet } = load("features/application-detail/interview-sheet.tsx", {
	"react-native": { View: "View", Linking: { openSettings: () => calls.push("settings") } },
	"@tanstack/react-query": { useQueryClient: () => nativeQueryClient },
	"@reactive-resume/schema/applications/data": mobileRequire("@reactive-resume/schema/applications/data"),
	"@reactive-resume/utils/string": { generateId: () => "person-fixture" },
	"@reactive-resume/utils/timezone": mobileRequire("@reactive-resume/utils/timezone"),
	"./calendar": nativeInterviewCalendar,
	"./date-field": { WallClockField: "WallClockField" },
	"./hooks": {
		useUserTime: () => ({ timeZone: "Europe/Berlin", when: String }),
		isInterview: (entry) => entry.type === "interview",
		interviewReminder: (_app, round) => round,
		interviewTypeLabel: String,
		leadLabel: String,
		useDetailMutations: () => ({
			addInterview: { isPending: false },
			updateInterview: {
				isPending: false,
				mutateAsync: async (input) => {
					savedInterviewInput = input;
					if (switchDuringSave) interviewScope = "another-account";
					if (saveInterviewError) throw new Error("Unavailable");
					return { ...nativeJob, activity: [{ ...nativeRound, ...input, id: nativeRound.id }] };
				},
			},
		}),
	},
	"@/api/client": {
		client: {
			applications: {
				deleteTimelineEntry: async (input) => {
					calls.push({ deleteRound: input });
					if (switchDuringDelete) interviewScope = "another-account";
					if (deleteInterviewError) throw new Error("Unavailable");
				},
			},
		},
	},
	"@/auth/session": { getAccountScope: () => interviewScope },
	"@/features/applications/queries": {
		applicationDetailQueryKey: (id) => ["application", id],
		useInvalidateApplications: () => () => calls.push("invalidate"),
	},
	"@/features/reminders": {
		...reminderSchedule,
		useReminders: () => nativeReminders,
		holdReminder: (id) => calls.push({ held: id }),
		releaseReminder: (id) => calls.push({ released: id }),
	},
	"@/lib/timezones": { timeZones: ["Europe/Berlin", "UTC"] },
	"@/ui": { ...ui, EditorSheet: "EditorSheet", toastLifetime: (ms) => ms },
});
const nativeInterviewForm = NativeInterviewSheet({
	open: true,
	application: nativeJob,
	interview: nativeRound,
	onClose() {},
}).type;
const renderNativeInterview = () =>
	render(nativeInterviewForm, { application: nativeJob, interview: nativeRound, onClose: () => calls.push("closed") });
for (const outcome of [undefined, "denied", "passed", new Error("Reminder unavailable")]) {
	reset();
	interviewScope = "fixture";
	reminderOutcome = outcome;
	control(renderNativeInterview(), "Time · Europe/Berlin").onChange("13:00");
	const view = renderNativeInterview();
	await view.props.footer.props.onPress();
	await settle();
	assert.equal(savedInterviewInput.entryId, nativeRound.id);
	assert.equal(savedInterviewInput.at, "2027-03-27T12:00:00.000Z");
	const result = calls.filter((call) => call?.message).at(-1);
	assert.equal(result.action.label, "Update your calendar", "reminder warning retains the update action");
	result.action.onPress();
	await settle();
	const shared = calls.find((call) => call?.event);
	assert.equal(shared.event.uid, nativeRound.id);
	assert.equal(shared.event.start.toISOString(), savedInterviewInput.at);
	assert.ok(shared.event.description.includes("Maya Example, Lead"));
	assert.equal(shared.method, "PUBLISH");
	interviewScope = "another-account";
	calls.length = 0;
	result.action.onPress();
	assert.equal(calls.length, 0, "old account action cannot share");
}
for (const fails of [false, true]) {
	reset();
	interviewScope = "fixture";
	switchDuringSave = true;
	saveInterviewError = fails;
	await renderNativeInterview().props.footer.props.onPress();
	await settle();
	assert.equal(calls.length, 0, "late save success/error cannot notify or close the next account");
}
switchDuringSave = saveInterviewError = false;
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
try {
	for (const scenario of ["undo", "deleted", "reminder-failed", "delete-failed", "switch-before", "switch-during"]) {
		reset();
		interviewScope = "fixture";
		deleteInterviewError = scenario === "delete-failed";
		switchDuringDelete = scenario === "switch-during";
		reminderOffError = scenario === "reminder-failed";
		let commit;
		globalThis.setTimeout = (callback, ms) => {
			assert.equal(ms, 6000);
			commit = callback;
			return 1;
		};
		globalThis.clearTimeout = () => {
			commit = null;
		};
		control(renderNativeInterview(), "Delete interview").onPress();
		assert.equal(calls.find((call) => call?.message)?.action.label, "Undo");
		assert.equal(calls.filter((call) => call?.event).length, 0);
		if (scenario === "undo") calls.find((call) => call?.message).action.onPress();
		if (scenario === "switch-before") interviewScope = "another-account";
		commit?.();
		await settle();
		const cancellation = calls.find((call) => call?.action?.label === "Download cancellation");
		if (scenario === "deleted" || scenario === "reminder-failed") {
			assert.ok(cancellation, "only a committed server delete offers cancellation");
			if (reminderOffError) assert.ok(cancellation.message.includes("Couldn't cancel its device reminder"));
			cancellation.action.onPress();
			await settle();
			const shared = calls.find((call) => call?.event);
			assert.equal(shared.event.uid, nativeRound.id);
			assert.equal(shared.method, "CANCEL");
		} else assert.equal(cancellation, undefined);
		if (scenario === "undo" || scenario === "switch-before")
			assert.equal(
				calls.find((call) => call?.deleteRound),
				undefined,
			);
		assert.ok(
			calls.some((call) => call?.released === nativeRound.id),
			"every completion releases the reminder hold",
		);
	}
} finally {
	globalThis.setTimeout = originalTimeout;
	globalThis.clearTimeout = originalClearTimeout;
}
interviewScope = "fixture";
console.log("PASS native calendar reschedule, reminder warnings, deferred deletion/Undo and account fences");

// Applications empty states must offer an action that changes the visible collection.
let applications = [];
let applicationSearch = "";
let applicationNeedsYou = false;
let needsFollowUpFixture = false;
const listLogic = load("features/applications/list.ts", {
	"@reactive-resume/schema/applications/next-step": domainNextStep,
	"./stages": { LIST_ORDER: ["interview", "offer", "screening", "applied", "saved", "closed"] },
	"./lanes": lanes,
});
const { ApplicationsListScreen } = load("features/applications/list-screen.tsx", {
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en" } }) },
	"./add-sheet": { AddApplicationSheet: "AddApplicationSheet" },
	"./error": { applicationError: String },
	"./lane-queries": laneQuery,
	"./lanes": lanes,
	"./list": listLogic,
	"./stage-actions": {
		offerHintFor: () => undefined,
		useOfferHints: () => undefined,
		useMoveWithUndo: () => (input) => calls.push({ moveWithUndo: input }),
	},
	"./next-step": {
		getNextStep: () => (needsFollowUpFixture ? { kind: "no-reply", days: 20 } : {}),
		describeNextStep: () => ({ title: "Saved" }),
		needsFollowUp: () => needsFollowUpFixture,
	},
	"expo-sqlite/kv-store": { getItemSync: () => null, setItemSync: () => {} },
	"./queries": {
		useApplications: () => ({ data: applications }),
		useApplicationMutations: () => ({
			logFollowUp: { isPending: false, mutate: (input) => calls.push({ logFollowUp: input }) },
		}),
		useApplicationDetailPrefetch: () => () => {},
	},
	"./stages": {
		PIPELINE: ["saved", "applied", "screening", "interview", "offer"],
		CLOSED_REASONS: [],
		getStageColor: () => "gray",
		getStageLabel: (value) => value,
	},
	"@/auth/session": {
		useSession: () => ({ status: "signed-in", server: "fixture" }),
		getAccountScope: () => "fixture-account",
	},
	"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => ({ timeZone: "UTC" }) },
	"@/features/applications-board/views": { ApplicationsViewFrame: "ApplicationsViewFrame" },
	"@/features/applications-board/search": {
		useApplicationSearch: () => ({
			search: applicationSearch,
			needsYou: applicationNeedsYou,
			setSearch: (value) => {
				applicationSearch = value;
			},
			clearFilters: () => {
				applicationSearch = "";
				applicationNeedsYou = false;
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
	activity: [],
	appliedAt: "2026-10-19T10:00:00Z",
	followUpAt: null,
	followUpNote: null,
};
applications = [job];
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.ListEmptyComponent.props.title, "All your applications are closed");
assert.equal(sectionList.props.ListEmptyComponent.props.action.label, "Show closed applications");
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
applicationNeedsYou = true;
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.sections.length, 0, "Needs you hides the selected Saved application");
assert.equal(sectionList.props.ListEmptyComponent.props.action.label, "Clear filters");
sectionList.props.ListEmptyComponent.props.action.onPress();
assert.equal(applicationNeedsYou, false);
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(
	nodes(sectionList.props.renderItem({ item: applications[0] })).find((node) => node.type === "ListRow").props.leading,
	"square",
	"Clearing Needs you never restores a hidden bulk selection",
);
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
	"./search": {
		useApplicationSearch: () => ({
			search: "",
			setSearch() {},
			needsYou: applicationNeedsYou,
			setNeedsYou: (value) => {
				applicationNeedsYou = value;
			},
		}),
	},
	"@/features/applications/add-sheet": { AddApplicationSheet: "AddApplicationSheet" },
	"@/features/applications/import-sheet": { ImportApplicationsSheet: "ImportApplicationsSheet" },
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
	assert.equal(control(tree, "Needs you").selected, false);
	control(tree, "Needs you").onPress();
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	assert.equal(control(tree, "Needs you").selected, true);
	control(tree, "Needs you").onPress();
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	const header = nodes(tree).find((node) => node.type === "CollectionHeader");
	control(header.props.actions, "Import from CSV").onPress();
	tree = render(ApplicationsViewFrame, { current: view, children: "View" });
	assert.equal(nodes(tree).find((node) => node.type === "ImportApplicationsSheet").props.open, true);
	nodes(tree)
		.find((node) => node.type === "ImportApplicationsSheet")
		.props.onClose();
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

let identityChanged;
const { useApplicationSearch: sharedFilters } = load("features/applications-board/search.ts", {
	zustand: createRequire(new URL("../package.json", import.meta.url))("zustand"),
	"@/auth/session": { subscribeIdentity: (listener) => (identityChanged = listener) },
});
sharedFilters.getState().setSearch("Fictional private company");
sharedFilters.getState().setNeedsYou(true);
identityChanged();
assert.equal(sharedFilters.getState().search, "");
assert.equal(sharedFilters.getState().needsYou, false, "Attention filtering clears with the account identity");

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
let matchedPosting = null;
const { AddApplicationSheet } = load("features/applications/add-sheet.tsx", {
	"@reactive-resume/utils/timezone": timeParser,
	"@reactive-resume/schema/applications/posting-source": load(
		"../../../packages/schema/src/applications/posting-source.ts",
		{ "@reactive-resume/utils/timezone": timeParser },
	),
	"@reactive-resume/import/job-posting": { readPastedPostingHeader: () => null },
	"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => ({ timeZone: "UTC" }) },
	react: { ...react, useEffect: () => {} },
	"@orpc/client": { ORPCError: class extends Error {} },
	"@tanstack/react-query": {
		useQuery: (options) => ({ data: options.queryKey[0] === "posting-match" ? matchedPosting : [] }),
	},
	"./date": { parseDateOnly: () => new Date() },
	"@/features/documents/filter": { defaultCopySource: () => undefined },
	"./error": { applicationError: String },
	"./lane-notice": { LaneNotice: "LaneNotice" },
	"./lane-queries": laneQuery,
	"./lanes": lanes,
	"./prior-no-response": { PriorNoResponse: "PriorNoResponse" },
	"./queries": {
		useApplicationMutations: () => ({
			update: { mutateAsync: async (input) => calls.push(input) },
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
control(addView(), "Role").onChangeText("Engineer");
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

reset();
matchedPosting = { id: "existing-job", company: "Example", role: "Engineer" };
const pickerView = () =>
	render(AddApplicationSheet, {
		initialCapture: {
			url: "https://example.test/jobs/1",
			company: "Example",
			role: "Engineer",
			description: "Posting",
		},
		onClose: () => calls.push("close-picker"),
		onAdded: (id) => calls.push({ picked: id }),
	});
assert.equal(control(pickerView(), "Update posting details").disabled, false);
control(pickerView(), "Update posting details").onPress();
await settle();
assert.equal(calls[0].id, "existing-job");
assert.deepEqual(
	calls.slice(1),
	["close-picker", { picked: "existing-job" }],
	"duplicate update returns to picker without navigation",
);
matchedPosting = null;
console.log("PASS native duplicate posting update preserves picker flow");

// Default calendar month/day follows the account clock; explicit navigation remains pinned.
const calendarSchedule = load("features/reminders/schedule.ts", { "@reactive-resume/utils/timezone": {} });
const nativeCalendar = load("features/applications-board/calendar.ts", {
	"../reminders/schedule.ts": calendarSchedule,
});
const calendarTokens = load("ui/tokens.ts", { "react-native": { Easing: { bezier: () => null } } });
let calendarNow = new Date("2026-10-31T22:59:30Z");
let calendarNeedsYou = false;
let calendarRows = [
	{
		id: "calendar-application",
		company: "Fictional Labs",
		role: "Engineer",
		status: "interview",
		appliedAt: "2026-10-01T09:00:00Z",
		followUpAt: null,
		followUpNote: null,
		tags: [],
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
	"@/features/applications/stage-actions": { useOfferHints: () => undefined },
	"react-native": { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", RefreshControl: "RefreshControl" },
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-GB" } }) },
	"@lingui/core/macro": {
		plural: (value, forms) => (forms[value] ?? forms[value === 1 ? "one" : "other"]).replace("#", String(value)),
	},
	"./calendar": nativeCalendar,
	"./search": {
		useApplicationSearch: () => ({
			search: "",
			needsYou: calendarNeedsYou,
			clearFilters: () => {
				calendarNeedsYou = false;
			},
		}),
	},
	"./views": { ApplicationsViewFrame: "ApplicationsViewFrame" },
	"@/features/application-detail/hooks": {
		useNow: () => calendarNow,
		useUserTime: () => ({ timeZone: "Europe/Berlin", time: () => "" }),
		interviewTypeLabel: (kind) => kind,
	},
	"@/features/application-detail/interview-sheet": { InterviewSheet: "InterviewSheet" },
	"@/features/application-detail/sheets": { FollowUpSheet: "FollowUpSheet" },
	"@/features/applications/error": { applicationError: () => "offline" },
	"@/features/applications/list": { filterApplications: listLogic.filterApplications },
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
reset();
calendarNow = new Date("2026-11-01T09:00:00Z");
calendarRows = [
	{
		...calendarRows[0],
		activity: [{ ...calendarRows[0].activity[0], at: "2026-12-01T09:00:00Z" }],
	},
];
calendarNeedsYou = true;
const filteredCalendar = nodes(calendarView()).find((node) => node.type === "EmptyState").props;
assert.equal(filteredCalendar.title, "No matching applications");
assert.equal(filteredCalendar.action.label, "Clear filters");
filteredCalendar.action.onPress();
assert.equal(calendarNeedsYou, false);
assert.ok(calendarText().includes("Coming up"));
assert.ok(nodes(calendarView()).some((node) => node.props.event?.day === "2026-12-01"));
console.log("PASS native calendar explains filtered-empty events and clears the filter");

// Manual offers use the production parser; only native widgets, transport and profile loading are boundaries.
const amountParser = load("../../../packages/utils/src/amount.ts");
const careerSchema = load("../../../packages/schema/src/career.ts", {
	zod,
	"./applications/data": load("../../../packages/schema/src/applications/data.ts", {
		zod,
		"@reactive-resume/utils/timezone": timeParser,
	}),
	"@reactive-resume/utils/region": { searchRegionsSchema: zod.z.array(zod.z.string()).nullable().optional() },
	"@reactive-resume/utils/timezone": timeParser,
});
const offerParser = load("../../../packages/schema/src/career-offer.ts", {
	"./career": careerSchema,
	"@reactive-resume/utils/amount": amountParser,
	"@reactive-resume/utils/timezone": timeParser,
});
let offerScope = "offer-account";
let offerProfile = { isSuccess: false, isPending: true, isError: false };
let savedOffers = [
	{ createdAt: "2026-09-01T00:00:00Z", data: { kind: "offer", currency: "USD" } },
	{ createdAt: "2026-10-01T00:00:00Z", data: { kind: "offer", currency: "GBP" } },
];
let offerApplications = { data: [] };
let loseOfferResponse = false;
let offerFailures = 0;
const { OfferEntry, OfferForm } = load("features/career/offer-entry.tsx", {
	"@reactive-resume/utils/string": load("../../../packages/utils/src/string.ts", { uuid: serverRequire("uuid") }),
	"@/auth/session": { getAccountScope: () => offerScope },
	"@reactive-resume/schema/career": careerSchema,
	"@reactive-resume/schema/career-offer": offerParser,
	"./hooks": {
		useCareerTime: () => ({ locale: "en-US", timeZone: "Europe/Berlin", profile: offerProfile }),
		useCareerAction: () => ({
			pending: false,
			run: async (work, success) => {
				try {
					success(await work());
				} catch {
					offerFailures++;
				}
			},
		}),
		client: {
			career: {
				createOffer: async (input) => {
					calls.push(input);
					return { id: "new-offer", data: { kind: "offer", ...input } };
				},
				updateOffer: async (input) => {
					calls.push(input);
					if (loseOfferResponse) {
						loseOfferResponse = false;
						throw new Error("Response lost after commit");
					}
					return { id: "new-version", data: { kind: "offer", ...input.terms } };
				},
			},
		},
		useOffers: () => ({ data: savedOffers }),
		useCareerQueries: () => ({ profile: { data: undefined } }),
	},
	"./offer-compare": { formatMoney: (_locale, currency, amount) => `${currency} ${amount}` },
	"./shared": { EditorSheet: "EditorSheet", LoadState: "LoadState" },
	"@/features/application-detail/date-field": { WallClockField: "WallClockField" },
	"@/features/applications/lane-queries": laneQuery,
	"@/features/applications/lanes": lanes,
	"@/features/applications/stage-actions": {
		useMoveWithUndo: () => (input) => calls.push({ moveWithUndo: input }),
	},
	"@/features/applications/queries": { useApplications: () => offerApplications },
});
reset();
offerApplications = { isPending: true };
assert.equal(render(OfferEntry, {}).type, "LoadState", "unknown metadata offers no ready action");
offerApplications = { isError: true };
assert.equal(render(OfferEntry, {}).type, "LoadState", "failed metadata stays retryable, not empty");
offerApplications = { isError: true, data: [] };
assert.equal(render(OfferEntry, {}).type, "LoadState", "failed refresh with cached empty metadata stays retryable");
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
const initialOffers = savedOffers;
savedOffers = [];
offerView();
assert.equal(control(offerView(), "Currency").value, "", "empty results do not invent a currency");
savedOffers = initialOffers;
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
// J2-06: a new application scope starts with fresh component state. Saving moves it to Offer, with Undo.
reset();
offerProfile = { isSuccess: true, isPending: false, isError: false };
const appliedEntry = render(OfferEntry, {
	application: { id: "job", company: "Fictional Labs", role: "Engineer", status: "applied" },
	initialOpen: true,
});
const appliedForm = nodes(appliedEntry).find((node) => typeof node.type === "function" && node.props.onClose);
assert.ok(appliedForm, "initialOpen shows the form at once");
reset();
const appliedView = () => render(appliedForm.type, { ...appliedForm.props, onClose() {} });
control(appliedView(), "Currency").onChangeText("EUR");
control(appliedView(), "Save offer").onPress();
await settle();
const moved = calls.find((call) => call?.moveWithUndo)?.moveWithUndo;
assert.deepEqual(moved?.applications, [{ id: "job" }]);
assert.equal(moved?.lane.category, "offer");
assert.equal(moved?.message, "Offer saved. Fictional Labs moved to Offer.");
console.log("PASS native offer validation, draft preservation, profile loading/failure and blank deadline");

// RX-202: the real native form preserves the percentage and requests a new version, never an overwrite.
reset();
offerProfile = { isSuccess: true, isPending: false, isError: false };
searchParams = { b: "pinned-offer" };
const originalTerms = careerSchema.offerTermsSchema.parse({
	currency: "EUR",
	period: "year",
	base: 85000,
	variable: null,
	variablePercent: 10,
});
const correctedView = () =>
	render(OfferForm, {
		application: { id: "job", company: "Northwind Labs", role: "Engineer" },
		offer: { id: "original-offer", data: originalTerms },
		onClose() {},
	});
assert.equal(control(correctedView(), "Bonus").value, "10%");
assert.equal(control(correctedView(), "Bonus").keyboardType, "default", "percentage entry needs a percent key");
control(correctedView(), "Bonus").onChangeText("12.5%");
loseOfferResponse = true;
control(correctedView(), "Save offer").onPress();
await settle();
assert.equal(offerFailures, 1);
assert.equal(calls.length, 1, "lost response keeps the native form open without navigation");
control(correctedView(), "Save offer").onPress();
await settle();
assert.deepEqual(calls[1], calls[0], "retry uses the same version receipt after a lost response");
assert.match(calls[0].newId, /^[0-9a-f-]{36}$/);
assert.equal(calls[0].id, "original-offer");
assert.equal(calls[0].newVersion, true);
assert.equal(calls[0].terms.variable, null);
assert.equal(calls[0].terms.variablePercent, 12.5);
assert.deepEqual(calls[0].expected, originalTerms);
assert.ok(
	calls.some(
		(call) =>
			call?.params?.a === "new-version" && call.params.highlight === "new-version" && call.params.b === "pinned-offer",
	),
);
calls.length = 0;
offerScope = "another-account";
control(correctedView(), "Save offer").onPress();
await settle();
assert.equal(calls.length, 0, "retired native offer form cannot write for the next account");
offerScope = "offer-account";
searchParams = {};
console.log("PASS native percentage entry and immutable offer-version action");

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
control(storyView(), "Situation").onChangeText("Customers could not finish setup.");
control(storyView(), "Action").onChangeText("I repaired setup.");
control(storyView(), "Task").onChangeText(" ");
const originalAnimationFrame = globalThis.requestAnimationFrame;
try {
	globalThis.requestAnimationFrame = (callback) => callback();
	assert.equal(control(storyView(), "Save story").disabled, false, "Missing parts cannot silently disable Save");
	control(storyView(), "Task").ref({ focus: () => calls.push("focus-task") });
	control(storyView(), "Save story").onPress();
	assert.deepEqual(calls, ["focus-task"], "Invalid drafts focus Task without making a request");
	assert.equal(control(storyView(), "Task").error, "Complete Task before saving.");
	assert.equal(control(storyView(), "Situation").value, "Customers could not finish setup.");
	control(storyView(), "Task").onChangeText("Restore setup.");
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
let pictureOptions;
const { PictureScreen } = load("features/write/picture-screen.tsx", {
	"@tanstack/react-query": {
		useMutation: (options) => {
			pictureOptions = options;
			return {};
		},
	},
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

// Resume review: native orchestration only; canonical persistence belongs to the HTTP/SQL regression.
reset();
let knowledgeScope = "alice@server-a";
const factReview = {
	id: "owned-resume",
	name: "Maya Example",
	updatedAt: new Date("2030-01-01"),
	omitted: 0,
	proposals: [
		{ text: "Led twelve engineers.", category: "experience", quote: "Led twelve engineers." },
		{ text: "TypeScript", category: "skill", quote: "- **TypeScript**" },
	],
};
const knowledgeRequests = [];
let replyFacts = async () => factReview;
const mutations = [];
const { ResumeFacts } = load("features/career/resume-facts.tsx", {
	"@reactive-resume/schema/career": careerSchema,
	"@tanstack/react-query": {
		useQuery: () => ({ isSuccess: true, data: [{ id: "owned-resume", name: "Maya", type: "resume" }], refetch() {} }),
		useQueryClient: () => ({ invalidateQueries() {} }),
		useMutation: (options) => {
			const [state, setState] = react.useState({ isPending: false, error: null });
			return {
				...state,
				reset: () => setState({ isPending: false, error: null }),
				mutate: () => {
					setState({ isPending: true, error: null });
					const pending = Promise.resolve()
						.then(options.mutationFn)
						.then(
							(result) => {
								setState({ isPending: false, error: null });
								options.onSuccess?.(result);
							},
							(error) => setState({ isPending: false, error }),
						);
					mutations.push(pending);
				},
			};
		},
	},
	"./fact-categories": {
		factCategories: () => [
			{ value: "experience", label: "Experience" },
			{ value: "skill", label: "Skill" },
		],
	},
	"./shared": { EditorSheet: "EditorSheet", LoadState: "LoadState", SwitchRow: "SwitchRow" },
	"@/auth/session": {
		getAccountScope: () => knowledgeScope,
		useSession: () => ({ server: "server-a", status: "signed-in" }),
	},
	"@/api/client": {
		orpc: {
			documents: { list: { queryOptions: () => ({ queryKey: ["documents"] }) } },
			career: { facts: { key: () => ["facts"] } },
		},
		client: {
			career: {
				proposeResumeFacts: async (input, options) => {
					knowledgeRequests.push({ preview: input, options });
					return replyFacts();
				},
				saveResumeFacts: async (input, options) => {
					knowledgeRequests.push({ save: input, options });
					return { saved: 1, skipped: 0 };
				},
			},
		},
	},
	"@/features/workspace/hooks": { workspaceError: (_cause, fallback) => fallback },
});
control(render(ResumeFacts, {}), "Pull facts from my resume").onPress();
const factForm = nodes(render(ResumeFacts, {})).find((node) => typeof node.type === "function");
assert.ok(factForm);
reset();
const factView = () => render(factForm.type, factForm.props);
assert.equal(control(factView(), "Review resume facts").disabled, true);
control(factView(), "Resume").onChange("owned-resume");
control(factView(), "Review resume facts").onPress();
await Promise.all(mutations);
assert.equal(knowledgeRequests.length, 1, "preview never saves");
assert.deepEqual(knowledgeRequests[0], {
	preview: { resumeId: "owned-resume" },
	options: { context: { scope: "alice@server-a" } },
});
const firstFact = nodes(factView()).find((node) => node.props.label === "Fact");
const unicodeFact = "A" + "😀".repeat(1999);
firstFact.props.onChangeText(unicodeFact);
assert.equal(nodes(factView()).find((node) => node.props.label === "Fact").props.value, unicodeFact);
nodes(factView())
	.find((node) => node.props.label === "Fact")
	.props.onChangeText("x".repeat(2001));
assert.equal(nodes(factView()).find((node) => node.props.label === "Fact").props.value, unicodeFact);
firstFact.props.onChangeText("Led twelve engineers delivering tools.");
nodes(factView())
	.filter((node) => node.props.label === "Save this fact")[1]
	.props.onValueChange(false);
control(factView(), "Save selected facts").onPress();
await Promise.all(mutations);
assert.deepEqual(knowledgeRequests[1].save, {
	resumeId: "owned-resume",
	updatedAt: factReview.updatedAt,
	proposals: [
		{ text: "Led twelve engineers delivering tools.", category: "experience", quote: "Led twelve engineers." },
	],
});
assert.equal(nodes(factView()).filter((node) => node.props.label === "Fact").length, 0);
let finishFacts;
replyFacts = () =>
	new Promise((resolve) => {
		finishFacts = resolve;
	});
control(factView(), "Review resume facts").onPress();
await settle();
knowledgeScope = "bob@server-b";
finishFacts(factReview);
await Promise.all(mutations);
assert.equal(
	nodes(factView()).filter((node) => node.props.label === "Fact").length,
	0,
	"late old-account excerpts cannot enter new-account review",
);
control(factView(), "Review resume facts").onPress();
await Promise.all(mutations);
assert.equal(knowledgeRequests.length, 3, "a stale account/server callback sends nothing");
console.log(
	"PASS native explicit resume selection, editable selected-only review, consented save and late account/server isolation",
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
	// The list sorts newest first; wall-clock milliseconds must not reverse this serial-write fixture.
	firstSeenAt: new Date(Date.UTC(2026, 10, 2 - index, 12)),
	lastSeenAt: new Date(),
	discoverySource: null,
}));
let todayApplications = [];
let todayOffers = [];
let todayOfferState = { isPending: false, isError: false };
let todayNow = new Date();
const { TodayScreen } = load("features/career/today.tsx", {
	"@/features/applications/stage-actions": { useOfferHints: () => undefined, offerHintFor: () => undefined },
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
		useSaveTimezone: () => ({ isPending: false, mutate() {} }),
		useNow: () => todayNow,
		useOffers: () => ({ data: todayOffers, ...todayOfferState }),
		useTodayQueries: () => ({
			schedules: { data: [] },
			opportunities: { data: discovered },
			notifications: { data: [] },
			briefings: { data: [] },
		}),
		useUndoRows: () => ({ hidden: [], remove() {} }),
	},
	"./schedule-sheet": { ScheduleSheet: "ScheduleSheet", scheduleTitle: (kind) => kind },
	"./scheduling": { collectInterviews: () => [], firstLeadAhead: () => "24h", rollForward: (at) => at },
	"./shared": { Actions: "Actions", LoadState: "LoadState", Section: "Section", SwitchRow: "SwitchRow" },
	"@/features/applications/lane-queries": { useApplicationLanes: () => ({ lanes: [] }) },
	"@/features/applications/lanes": { getLaneLabel: () => "Saved", resolveLane: () => null },
	"@/features/applications/next-step": nextSteps,
	"@/features/applications/queries": { useApplications: () => ({ data: todayApplications, refetch() {} }) },
	"@/routes": {
		routes: {
			...routes,
			application: (id, tab, round) => {
				calls.push({ todayRoute: { id, tab, round } });
				return routes.application(id, tab);
			},
		},
	},
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

reset();
todayNow = new Date("2030-01-03T10:00:00Z");
todayApplications = [
	{
		...nativeJob,
		status: "offer",
		activity: [],
		followUpAt: "2030-01-03T11:00:00Z",
		followUpDateOnly: false,
		followUpNote: "Email Maya",
	},
];
todayOffers = [
	{ applicationId: nativeJob.id, createdAt: "2030-01-02", data: { kind: "offer", respondBy: "2030-01-03T12:00:00Z" } },
];
const comingUpView = () =>
	nodes(render(TodayScreen)).find((node) => node.type === "Section" && node.props.title === "Coming up");
let comingUp = comingUpView();
assert.ok(JSON.stringify(comingUp).includes("Follow-up reminder"));
assert.ok(JSON.stringify(comingUp).includes("Email Maya"));
assert.ok(JSON.stringify(comingUp).includes("Reply to the offer"));
control(comingUp, "Open workspace").onPress();
assert.deepEqual(calls.find((call) => call?.todayRoute).todayRoute, {
	id: nativeJob.id,
	tab: "messages",
	round: undefined,
});
todayOffers = [
	...todayOffers,
	{ applicationId: nativeJob.id, createdAt: "2030-01-03", data: { kind: "offer", respondBy: null } },
];
assert.ok(!JSON.stringify(comingUpView()).includes("Reply to the offer"), "a newer offer clears its earlier deadline");
for (const state of [
	{ isPending: true, isError: false },
	{ isPending: false, isError: true },
]) {
	todayOfferState = state;
	todayOffers = undefined;
	const partial = comingUpView();
	assert.match(JSON.stringify(partial), /Email Maya/);
	assert.doesNotMatch(JSON.stringify(partial), /Reply to the offer/);
	assert.ok(control(partial, "Open workspace"));
}
todayOfferState = { isPending: false, isError: false };
todayOffers = [];
todayApplications = [{ ...todayApplications[0], activity: [{ ...nativeRound, at: "2030-01-03T09:30:00Z" }] }];
calls.length = 0;
comingUp = comingUpView();
control(comingUp, "Open workspace").onPress();
assert.deepEqual(calls.find((call) => call?.todayRoute).todayRoute, {
	id: nativeJob.id,
	tab: "prepare",
	round: nativeRound.id,
});
todayApplications = [{ ...todayApplications[0], status: "closed" }];
assert.ok(!JSON.stringify(comingUpView()).includes("Open workspace"));
todayApplications = [];
todayOffers = [];
console.log("PASS native Today shows simultaneous dated steps, latest offer clearing and exact interview navigation");

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

let headerSaved = { data: undefined, isPending: true, isError: false, refetch: () => calls.push("retry-saved") };
const { WorkspaceScreen } = load("features/workspace/shell.tsx", {
	"@reactive-resume/schema/career": careerSchema,
	"./coach-sheet": { CoachSheet: "CoachSheet" },
	"./hooks": {
		useSavedItems: () => headerSaved,
		useWorkspace: () => ({ isPending: false, query: { isError: false, data: {}, refetch: () => {} } }),
	},
	"./logic": { currentInterview: () => undefined },
	"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => time },
	"@/features/application-detail/interview-sheet": { InterviewSheet: "InterviewSheet" },
	"@/features/applications/error": { applicationError: String },
	"@/features/applications/lane-queries": laneQuery,
	"@/features/applications/lanes": lanes,
	"@/features/applications/queries": {
		useApplication: () => ({
			data: { ...application, status: "offer", company: "Context job", role: "Engineer" },
			isPending: false,
		}),
	},
	"@/routes": { routes: { ...routes, career: (tab) => `/career/${tab}` } },
	"@/shell/workspace-chrome": { useWorkspaceChrome: () => {} },
	"@/ui/keyboard": { useKeyboardScrollSpace: () => 0 },
	"react-native-keyboard-controller": { KeyboardAwareScrollView: "KeyboardAwareScrollView" },
});
const workspaceHeader = () => {
	reset();
	const screen = render(WorkspaceScreen, { tab: "messages", children: () => null });
	const header = nodes(screen).find((node) => node.type?.name === "Header");
	assert.ok(header);
	return { screen, header: render(header.type, header.props) };
};
assert.equal(control(workspaceHeader().header, "Compare offers").disabled, true);
headerSaved = { ...headerSaved, isPending: false, isError: true };
const failedHeader = workspaceHeader();
assert.equal(control(failedHeader.header, "Compare offers").disabled, true);
assert.ok(control(failedHeader.screen, "Try again"));
headerSaved = { ...headerSaved, isError: false, data: [{ id: "context-latest", data: { kind: "offer" } }] };
const loadedHeader = control(workspaceHeader().header, "Compare offers");
assert.equal(loadedHeader.disabled, false);
loadedHeader.onPress();
assert.deepEqual(calls.at(-1), { pathname: "/career/offers", params: { a: "context-latest" } });
console.log("PASS native contextual offers gated cold/error and retain latest offer when loaded");

reset();
const scheduleWrites = [];
const scheduleRow = {
	id: "follow-up-a",
	kind: "follow-up",
	applicationId: application.id,
	nextRunAt: new Date("2030-01-03T09:15:37.123Z"),
	timezone: "UTC",
	query: "Original note",
	intervalDays: null,
	enabled: true,
	email: false,
};
const ready = (data) => ({ data, isPending: false, isError: false });
let scheduleScope = "schedule-account";
let scheduleApplications = [{ ...application, status: "applied" }];
let scheduleDetail = { isPending: false, isFetching: false, isSuccess: false };
const scheduleTime = { timeZone: "UTC", locale: "en-US", profile: ready({ emailVerified: true }) };
const scheduleCareer = { profile: ready({ targetRoles: [], locations: [] }) };
const scheduleApi = { career: { saveSchedule: async (input) => scheduleWrites.push(input) } };
const scheduling = load("features/career/scheduling.ts", { "@reactive-resume/utils/timezone": timeParser });
const { ScheduleSheet } = load("features/career/schedule-sheet.tsx", {
	"@react-native-community/datetimepicker": { default: "DateTimePicker" },
	"@tanstack/react-query": { useQuery: () => ready({ search: false, provider: null }) },
	"@reactive-resume/schema/career": careerSchema,
	"@reactive-resume/utils/timezone": timeParser,
	"./hooks": {
		client: scheduleApi,
		useCareerAction: () => ({
			pending: false,
			run: async (operation, done) => {
				await operation();
				done();
			},
		}),
		useCareerQueries: () => scheduleCareer,
		useCareerTime: () => scheduleTime,
		useNow: () => new Date("2030-01-04T12:00:00Z"),
	},
	"./scheduling": scheduling,
	"./shared": { EditorSheet: "EditorSheet", LoadState: "LoadState", SwitchRow: "SwitchRow" },
	"@/api/client": { orpc: { webAccess: { status: { queryOptions: () => ({}), key: () => [] } } } },
	"@/api/flags": { useFlags: () => ready({ careerSchedulingEnabled: true, smtpEnabled: false }) },
	"@/auth/session": {
		getAccountScope: () => scheduleScope,
		useSession: () => ({ status: "signed-in", server: "https://example.test" }),
	},
	"@/features/ai/providers": {
		AIProviderSetupSheet: "AIProviderSetupSheet",
		useHasAIProvider: () => ({ usableProviders: [], defaultProvider: null, hasAIProvider: false }),
	},
	"@/features/applications/queries": {
		useApplications: () => ready(scheduleApplications),
		useApplication: () => scheduleDetail,
	},
});
const scheduleForm = render(ScheduleSheet, { schedule: scheduleRow, kind: "follow-up", onClose() {}, onDelete() {} });
let scheduleTree = render(scheduleForm.type, scheduleForm.props);
control(scheduleTree, "Follow-up note").onChangeText("Updated completed note");
scheduleTree = render(scheduleForm.type, scheduleForm.props);
control(scheduleTree, "Save schedule").onPress();
await settle();
assert.equal(scheduleWrites.length, 1, "past unchanged occurrence remains editable");
assert.equal(scheduleWrites[0].query, "Updated completed note");
assert.equal(scheduleWrites[0].nextRunAt.toISOString(), "2030-01-03T09:15:37.123Z");
control(scheduleTree, "Time (HH:mm)").onChangeText("09:16");
scheduleTree = render(scheduleForm.type, scheduleForm.props);
control(scheduleTree, "Save schedule").onPress();
await settle();
assert.equal(scheduleWrites.length, 1, "changed past time must still be rejected");
assert.match(JSON.stringify(render(scheduleForm.type, scheduleForm.props)), /Pick a time after now/);
console.log("PASS native Today past note edit preserves exact seconds and changed-past-time guard");

reset();
const noteApplication = {
	...application,
	activity: [{ id: "note", type: "note", at: "2030-01-02", text: "Email Maya\n about the next round" }],
};
scheduleApplications = [
	{ ...noteApplication, status: "applied" },
	{ ...noteApplication, id: "second-application", company: "Second application", status: "applied" },
];
scheduleDetail = { data: noteApplication, isPending: false, isFetching: false, isSuccess: true };
const newSchedule = render(ScheduleSheet, { schedule: null, kind: "follow-up", onClose() {}, onDelete() {} });
const noteScheduleView = () => render(newSchedule.type, newSchedule.props);
assert.equal(control(noteScheduleView(), "Follow-up note").value, "Email Maya about the next round");
control(noteScheduleView(), "Application").onChange("second-application");
assert.equal(
	control(noteScheduleView(), "Follow-up note").value,
	"",
	"a different application's late result cannot prefill",
);
scheduleDetail = {
	...scheduleDetail,
	data: {
		...noteApplication,
		id: "second-application",
		activity: [{ ...noteApplication.activity[0], text: "Call Priya" }],
	},
};
assert.equal(control(noteScheduleView(), "Follow-up note").value, "Call Priya");
control(noteScheduleView(), "Follow-up note").onChangeText("");
scheduleDetail = {
	...scheduleDetail,
	data: { ...scheduleDetail.data, activity: [{ ...noteApplication.activity[0], text: "Later server note" }] },
};
assert.equal(control(noteScheduleView(), "Follow-up note").value, "", "deliberately cleared note stays blank");
control(noteScheduleView(), "Application").onChange(application.id);
assert.equal(control(noteScheduleView(), "Follow-up note").value, "", "selection changes retain an authored blank");
control(noteScheduleView(), "What should run").onChange("discovery");
control(noteScheduleView(), "What should run").onChange("follow-up");
assert.equal(
	control(noteScheduleView(), "Follow-up note").value,
	"",
	"kind changes retain the authored follow-up draft",
);

reset();
scheduleDetail = { isPending: true, isFetching: true, isSuccess: false };
let pendingSchedule = render(ScheduleSheet, { schedule: null, kind: "follow-up", onClose() {}, onDelete() {} });
const pendingScheduleView = () => render(pendingSchedule.type, pendingSchedule.props);
assert.equal(
	control(pendingScheduleView(), "Save schedule").disabled,
	true,
	"automatic prefill waits for selected detail",
);
control(pendingScheduleView(), "Follow-up note").onChangeText("Authored before detail arrived");
scheduleDetail = { data: noteApplication, isPending: false, isFetching: false, isSuccess: true };
assert.equal(control(pendingScheduleView(), "Follow-up note").value, "Authored before detail arrived");
assert.equal(control(pendingScheduleView(), "Save schedule").disabled, false);
control(pendingScheduleView(), "Remind me on (YYYY-MM-DD)").onChangeText("2030-01-05");
control(pendingScheduleView(), "Save schedule").onPress();
await settle();
assert.equal(scheduleWrites.at(-1).query, "Authored before detail arrived");
scheduleScope = "different-account";
assert.equal(
	render(ScheduleSheet, { schedule: null, kind: "follow-up", onClose() {}, onDelete() {} }).props.key,
	"different-account",
	"account changes remount the draft owner",
);
scheduleScope = "schedule-account";
const failedPrefills = [];
for (const data of [undefined, noteApplication]) {
	reset();
	scheduleWrites.length = 0;
	scheduleDetail = { data, isPending: false, isFetching: false, isSuccess: false, isError: true };
	const failed = render(ScheduleSheet, { schedule: null, kind: "follow-up", onClose() {}, onDelete() {} });
	const view = () => render(failed.type, failed.props);
	control(view(), "Remind me on (YYYY-MM-DD)").onChangeText("2030-01-05");
	const note = control(view(), "Follow-up note").value;
	const disabled = control(view(), "Save schedule").disabled;
	control(view(), "Save schedule").onPress();
	await settle();
	failedPrefills.push({ cached: Boolean(data), note, disabled, saved: scheduleWrites.map((row) => row.query) });
	if (!data) {
		control(view(), "Follow-up note").onChangeText("");
		assert.equal(control(view(), "Save schedule").disabled, false, "an intentional blank ends automatic prefill");
		control(view(), "Save schedule").onPress();
		await settle();
		assert.equal(scheduleWrites.at(-1).query, "", "authored blanks remain saveable after an unavailable detail");
	}
}
assert.deepEqual(failedPrefills, [
	{ cached: false, note: "", disabled: true, saved: [] },
	{
		cached: true,
		note: "Email Maya about the next round",
		disabled: false,
		saved: ["Email Maya about the next round"],
	},
]);
console.log(
	"PASS native Remind me full-detail prefill, late/selection guards, authored blanks, persistence and account key",
);
{
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
		"@/routes": load("routes.ts"),
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
	for (const resumeId of ["linked-resume", null]) {
		reset();
		const tree = render(fitComponent, {
			application: { id: "app", resumeId },
			version: {
				data: {
					kind: "fit",
					headline: "Fit",
					summary: "Gap",
					requirements: [
						{ text: "Enterprise onboarding", status: "missing", evidence: "Not yet recorded", origin: "posting" },
					],
					checks: [],
				},
			},
		});
		const requirement = nodes(tree).find((node) => node.type?.name === "RequirementCard");
		assert.ok(requirement);
		control(render(requirement.type, requirement.props), "Tailor resume for this job").onPress();
		assert.deepEqual(
			calls.at(-1),
			resumeId
				? {
						pathname: "/builder/linked-resume/check?applicationId=app",
						params: { tab: "match" },
					}
				: {
						pathname: "/new",
						params: { step: "copy", applicationId: "app", destination: "job-match", context: "applications" },
					},
		);
	}
	console.log("PASS native Fit gaps hand off the exact job to Check or the existing copy flow");

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
		"@/features/applications/queries": {
			useApplications: () => ({ data: [] }),
			useApplication: () => ({ isPending: false, isFetching: false, isSuccess: false }),
		},
		"./scheduling": {
			collectInterviews: () => [],
			firstLeadAhead: () => "24h",
			nextCareerRun: () => new Date("2026-11-02T12:00:00Z"),
			toZoned: () => ({ date: "2026-11-02", time: "12:00" }),
		},
		"./shared": { EditorSheet: "EditorSheet", SwitchRow: "SwitchRow" },
		"@/api/client": { orpc: { webAccess: { status: { queryOptions: () => ({}), key: () => [] } } } },
		"@/api/flags": { useFlags: () => ({ data: { careerSchedulingEnabled: true } }) },
		"@/auth/session": {
			getAccountScope: () => "ai-schedule-account",
			useSession: () => ({ status: "signed-in", server: "https://fictional.example" }),
		},
		"@/features/ai/providers": { useHasAIProvider: () => scheduleAi },
		"@/features/ai/web-access": {},
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
}

const { CustomFields } = load("features/write/basics-screen.tsx", {
	"expo-image": { Image: "Image" },
	"@reactive-resume/utils/string": { generateId: () => "new-field" },
	"./entry-fields": { BoundText: "BoundText", LinkField: "LinkField", useValidators: () => ({}) },
	"./entry-screen": { EditorScreen: "EditorScreen" },
	"./hooks": { useWriteData: () => null },
	"./pickers": { IconPickerSheet: "IconPickerSheet", PromptSheet: "PromptSheet" },
	"./picture-screen": { resolvePictureUrl: () => "" },
	"@/auth/session": { useSession: () => ({}) },
	"@/draft": { useIsResumeLocked: () => false, useResumeStore: {} },
});
reset();
const removedField = { id: "field-one", icon: "acorn", text: "Portfolio", link: "https://portfolio.example/" };
let fieldDocument = { headline: "Before", fields: [removedField] };
const fieldHistory = [];
const updateFields = (mutate) => {
	fieldHistory.push(structuredClone(fieldDocument));
	fieldDocument = structuredClone(fieldDocument);
	mutate(fieldDocument.fields);
};
const fieldView = () =>
	render(CustomFields, {
		fields: fieldDocument.fields,
		locked: false,
		update: updateFields,
		undo: () => (fieldDocument = fieldHistory.pop()),
	});
control(fieldView(), "Remove field").onPress();
assert.equal(fieldDocument.fields.length, 0);
const removalToast = calls.find((value) => value.message === "Field removed");
assert.ok(removalToast);
fieldHistory.push(structuredClone(fieldDocument));
fieldDocument = { ...fieldDocument, headline: "Later edit" };
removalToast.action.onPress();
assert.equal(fieldDocument.headline, "Later edit", "field Undo preserves a later edit");
assert.deepEqual(fieldDocument.fields, [removedField], "field Undo restores only the removed field");
removalToast.action.onPress();
assert.deepEqual(fieldDocument.fields, [removedField], "a restored field is never duplicated");
console.log("PASS native custom-field Undo restores its field without reverting later edits or duplicating it");

// A job selected before its summary arrives must never become an unlinked copy.
let copyApplications = { data: [], isFetching: true, refetch() {} };
let newDocumentParams = { step: "copy", applicationId: "new-job" };
let copyHasProvider = false;
const { NewDocument } = load("features/documents/new-document.tsx", {
	"@/routes": load("routes.ts"),
	"./copy-for-job": {
		copyForJob: async (input) => {
			calls.push(input);
			return "copy";
		},
	},
	"./filter": { defaultCopySource: (rows) => rows.find((row) => !row.applicationId) ?? rows[0] },
	react: { ...react, useEffect() {} },
	"@tanstack/react-query": { useQuery: () => copyApplications },
	"expo-document-picker": {},
	"expo-file-system": {},
	"expo-network": { getNetworkStateAsync: async () => ({ isConnected: true }) },
	"expo-router": {
		useRouter: () => ({ replace: (href) => calls.push(href) }),
		useLocalSearchParams: () => newDocumentParams,
		Stack: { Screen: "StackScreen" },
	},
	"@reactive-resume/schema/resume/dates": {},
	"./import-file": { ImportError: class extends Error {} },
	"@/features/write/fields": { SECTION_TITLES: {} },
	"./new-documents": { useNewDocuments: { getState: () => ({ markOpened() {} }) } },
	"./queries": {
		useDocuments: () => ({
			data: [{ id: "source", type: "resume", name: "Resume" }],
			isPending: false,
			isError: false,
		}),
		useDocumentRefresh: () => () => {},
		documentError: String,
	},
	"@/api/client": {
		client: {
			coverLetters: {
				create: async (input) => {
					calls.push({ createdLetter: input });
					return { id: "letter-new" };
				},
			},
			documents: {
				list: async () => [],
				copyForJob: async (input) => {
					calls.push(input);
					return "copy";
				},
			},
		},
		orpc: { applications: { listSummary: { queryOptions: () => ({ queryKey: ["jobs"] }) } } },
	},
	"@/auth/session": { getServer: () => "test", useSession: () => ({ server: "test", status: "signed-in" }) },
	"@/features/ai/providers": { useHasAIProvider: () => ({ hasAIProvider: copyHasProvider }) },
	"@/features/applications/add-sheet": {},
});
reset();
assert.equal(control(render(NewDocument), "Create copy").disabled, true);
control(render(NewDocument), "Create copy").onPress();
await settle();
assert.deepEqual(calls, [], "pending selected job cannot create an unlinked copy");
copyApplications = {
	data: [{ id: "new-job", company: "Example", role: "Engineer", status: "saved" }],
	isFetching: false,
	refetch() {},
};
assert.equal(control(render(NewDocument), "Create copy").disabled, false);
control(render(NewDocument), "Create copy").onPress();
await settle();
assert.equal(calls[0].applicationId, "new-job");
console.log("PASS native copy waits for selected job and preserves application ID");

for (const hasProvider of [false, true]) {
	reset();
	copyHasProvider = hasProvider;
	newDocumentParams = { step: "copy", applicationId: "new-job", destination: "job-match" };
	copyApplications.data[0].status = "closed";
	control(render(NewDocument), "Create copy").onPress();
	await settle();
	assert.equal(calls[0].applicationId, "new-job");
	assert.deepEqual(calls[1], { pathname: "/builder/copy/check", params: { tab: "match" } });
}
copyHasProvider = false;
console.log("PASS native Fit copy opens Job match for its selected job, with or without an AI provider");

reset();
newDocumentParams = { context: "letters" };
const newLetter = render(NewDocument);
assert.equal(control(newLetter, "New cover letter").variant, "primary");
assert.equal(control(newLetter, "New cover letter").disabled, false);
assert.ok(
	nodes(newLetter).some((node) => node.type === "StackScreen" && node.props.options.title === "New cover letter"),
);
assert.ok(
	!nodes(newLetter).some((node) =>
		["Import a resume", "Copy a resume for a job", "Start blank"].includes(node.props.title),
	),
);
assert.ok(
	!nodes(newLetter).some((node) =>
		["Try with a sample resume", "Check a PDF with the ATS checker"].includes(node.props.label),
	),
);
control(newLetter, "New cover letter").onPress();
await settle();
assert.deepEqual(calls, [
	{ createdLetter: { name: "Untitled letter", recipient: "", content: "" } },
	"/letter/letter-new/write",
]);
newDocumentParams = {};
reset();
assert.ok(nodes(render(NewDocument)).some((node) => node.props.title === "Import a resume"));
assert.equal(control(render(NewDocument), "New cover letter instead").variant, "ghost");
console.log(
	"PASS native letter entry reuses creation screen without resume alternatives; ordinary New remains available",
);

{
	const { routes: realRoutes } = load("routes.ts");
	let documents = {
		data: [
			{ id: "resume-a", type: "resume", name: "Fictional resume" },
			{ id: "letter-a", type: "letter", name: "Fictional letter" },
		],
	};
	let applications = { data: [{ id: "job-a", role: "Engineer", company: "Fictional company" }] };
	let documentQueryEnabled;
	let applicationQueryEnabled;
	const { NextSteps } = load("features/ai/next-steps.tsx", {
		"@/routes": { routes: realRoutes },
		"@/ui": { ...ui, Sheet: "Sheet" },
		"@/features/documents/queries": {
			useDocuments: (_trashed, enabled) => {
				documentQueryEnabled = enabled;
				return documents;
			},
		},
		"@/features/applications/queries": {
			useApplications: (enabled) => {
				applicationQueryEnabled = enabled;
				return applications;
			},
		},
	});
	reset();
	let dismissed = false;
	const view = () =>
		render(NextSteps, {
			onDismiss: () => {
				dismissed = true;
			},
		});
	view();
	assert.equal(documentQueryEnabled, false);
	assert.equal(applicationQueryEnabled, false);
	for (const [action, expected] of [
		["Improve selected line", realRoutes.builder("resume-a", "write")],
		["Review writing", { pathname: "/builder/[id]/check", params: { id: "resume-a", tab: "writing" } }],
		["Check fit", realRoutes.application("job-a", "fit")],
	]) {
		control(view(), action).onPress();
		const picker = view();
		assert.equal(documentQueryEnabled, action !== "Check fit");
		assert.equal(applicationQueryEnabled, action === "Check fit");
		assert.ok(!nodes(picker).some((node) => node.props.title === "Fictional letter"));
		nodes(picker)
			.find((node) => node.props.title === (action === "Check fit" ? "Engineer" : "Fictional resume"))
			.props.onPress();
		assert.deepEqual(calls.at(-1), expected);
		assert.equal(nodes(view()).find((node) => node.type === "Sheet").props.open, false);
		assert.equal(documentQueryEnabled, false);
		assert.equal(applicationQueryEnabled, false);
	}
	control(view(), "New cover letter").onPress();
	assert.equal(calls.at(-1), "/new?context=letters");
	control(view(), "Ask the coach").onPress();
	assert.equal(calls.at(-1), realRoutes.career("coach"));
	documents = { data: [] };
	applications = { data: [] };
	control(view(), "Improve selected line").onPress();
	control(view(), "Import or create a resume").onPress();
	assert.equal(calls.at(-1), realRoutes.new());
	control(view(), "Check fit").onPress();
	control(view(), "Save a job").onPress();
	assert.equal(calls.at(-1), realRoutes.newJob());
	let retries = 0;
	documents = {
		error: new Error("Offline"),
		refetch: () => {
			retries++;
		},
	};
	control(view(), "Review writing").onPress();
	control(view(), "Try again").onPress();
	assert.equal(retries, 1);
	control(view(), "Dismiss").onPress();
	assert.equal(dismissed, true);
	console.log(
		"PASS native first-connection actions use real routes, gate pickers, preserve empty/error recovery, and do not import AI clients",
	);

	let providerState = { providers: [], usableProviders: [], isUnavailable: false };
	const { ProviderList } = load("features/ai/provider-list.tsx", {
		"@orpc/client": { ORPCError: class extends Error {} },
		"@tanstack/react-query": {},
		"./catalog": {},
		"./error": {},
		"./next-steps": { NextSteps },
		"./provider-editor": {},
		"./providers": { AIProviderSetupSheet: "SetupSheet", useHasAIProvider: () => providerState },
		"@/api/client": {},
	});
	reset();
	const providerView = () => render(ProviderList);
	const guidance = () => nodes(providerView()).find((node) => node.type === NextSteps);
	assert.equal(guidance(), undefined, "No success before setup");
	nodes(providerView())
		.find((node) => node.type === "SetupSheet")
		.props.onClose();
	assert.equal(guidance(), undefined, "Cancel does not show success");
	const first = { id: "first", testStatus: "success", enabled: true };
	nodes(providerView())
		.find((node) => node.type === "SetupSheet")
		.props.onReady(first);
	assert.equal(guidance(), undefined, "Success waits for usable canonical provider list");
	providerState = { ...providerState, providers: [first], usableProviders: [first] };
	assert.ok(guidance());
	guidance().props.onDismiss();
	assert.equal(guidance(), undefined);
	const second = { ...first, id: "second" };
	nodes(providerView())
		.find((node) => node.type === "SetupSheet")
		.props.onReady(second);
	providerState = { ...providerState, providers: [first, second], usableProviders: [first, second] };
	assert.equal(guidance(), undefined, "Second connection does not reintroduce dismissed guidance");
	console.log("PASS native first-success guidance waits for usable state and stays dismissed for a second provider");
}

// React Query uses the latest mutation options after asynchronous public-link counting.
let currentProfileMutation;
let profileMutationResult;
let finishLinkCount;
const { ProfileEditor } = load("features/settings/profile.tsx", {
	"@tanstack/react-query": {
		useQueryClient: () => ({ invalidateQueries() {} }),
		useMutation: (options) => {
			currentProfileMutation = options;
			return {
				isPending: false,
				reset() {},
				mutate() {
					profileMutationResult = currentProfileMutation.mutationFn();
				},
			};
		},
	},
	"expo-file-system": {},
	"expo-image-picker": {},
	"@/api/client": {
		client: {
			documents: {
				page: () =>
					new Promise((resolve) => {
						finishLinkCount = resolve;
					}),
			},
			auth: {
				updateProfile: async (input) => {
					calls.push(input);
					return { status: true };
				},
			},
		},
	},
	"@/auth/session": { useSession: () => ({ server: "test" }) },
});
reset();
const usernameField = nodes(render(ProfileEditor, { profile: { name: "Example", username: "old-name" } })).find(
	(node) => node.props.field === "username",
);
reset();
const profileView = () => render(usernameField.type, usernameField.props);
control(profileView(), "Username").onChangeText("valid-name");
control(profileView(), "Username").onBlur();
control(profileView(), "Username").onChangeText("!");
profileView();
finishLinkCount({ total: 1 });
await settle();
nodes(profileView())
	.find((node) => node.type === "ConfirmDialog")
	.props.onConfirm();
await assert.rejects(profileMutationResult, /Invalid profile field/);
assert.deepEqual(calls, [], "invalid draft never reaches profile API after confirmation");
assert.equal(control(profileView(), "Username").value, "!", "failed validation preserves draft");
console.log("PASS native username revalidates after asynchronous public-link confirmation");

reset();
pictureOptions.onError(new Error("Network request failed"));
assert.equal(calls.at(-1).message, "Couldn't upload the photo. Try again.");
pictureOptions.onError(new Error("Choose a photo smaller than 10 MB."));
assert.equal(calls.at(-1).message, "Choose a photo smaller than 10 MB.");
console.log("PASS native photo failure distinguishes network retry from size guidance");

let preferenceDraft;
let preferenceLocale;
const { Preferences } = load("features/career/preferences.tsx", {
	react: { ...react, useEffect() {}, useLayoutEffect() {} },
	"@tanstack/react-query": { useQueryClient: () => ({}) },
	"@reactive-resume/schema/career": careerSchema,
	"@reactive-resume/utils/amount": amountParser,
	"./hooks": {
		useCareerTime: () => ({ locale: preferenceLocale, timeZone: "UTC", profile: { data: { id: "owner" } } }),
	},
	"./role-suggestions": { RoleSuggestions: "RoleSuggestions" },
	"./search-regions-field": { SearchRegionsField: "SearchRegionsField" },
	"@/api/client": {},
	"@/auth/session": { useSession: () => ({ server: "test" }) },
	"@/features/workspace/hooks": {
		useDraft: (_key, initial) => {
			preferenceDraft ??= { ...initial, amount: "Invalid draft" };
			return {
				value: preferenceDraft,
				blocked: true,
				reset: (value) => {
					preferenceDraft = value;
				},
			};
		},
	},
});
for (const locale of ["de-DE", "fr-FR"]) {
	reset();
	preferenceLocale = locale;
	preferenceDraft = null;
	const initial = careerSchema.careerProfileDataSchema.parse({
		minBase: { amount: 1234.56, currency: "EUR", period: "month" },
	});
	control(render(Preferences, { initial }), "Use saved version").onPress();
	assert.equal(
		amountParser.parseAmount(preferenceDraft.amount, locale),
		1234.56,
		`${locale}: restored amount retains exact saved value`,
	);
	assert.equal(preferenceDraft.amount, new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(1234.56));
}
console.log("PASS native saved Preferences amounts round-trip in comma-decimal locales");

// The Facts control uses the shipped action owner, including pending/repeat and failure handling.
let memoryProfile = careerSchema.careerProfileDataSchema.parse({ memoryMode: "auto", priorities: "Mentoring" });
let memoryAccount = { id: "owner" };
let memoryServer = "test";
let finishMemory;
let rejectMemory;
const memoryApi = {
	career: {
		updateProfile: (input, options) => {
			calls.push({ input, options });
			return new Promise((resolve, reject) => {
				finishMemory = () => {
					memoryProfile = { ...memoryProfile, ...input };
					resolve(memoryProfile);
				};
				rejectMemory = reject;
			});
		},
	},
};
const memoryOrpc = Object.fromEntries(
	["career", "applications", "documents"].map((key) => [key, { key: () => [key] }]),
);
const memorySession = {
	useSession: () => ({ status: "signed-in", server: "test" }),
	getServer: () => memoryServer,
};
const { useCareerAction: memoryAction } = load("features/career/hooks.ts", {
	"@orpc/client": { ORPCError: Error },
	"@tanstack/react-query": {
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
	},
	"./undo": {},
	"@/api/client": { client: memoryApi, orpc: memoryOrpc },
	"@/auth/session": memorySession,
	"@/features/settings/queries": {},
});
const { Facts: KnowledgeFacts } = load("features/career/facts.tsx", {
	"./fact-categories": load("features/career/fact-categories.ts"),
	"./resume-facts": { ResumeFacts },
	react: {
		...react,
		memo: (component) => component,
		useMemo: (fn) => fn(),
		useDeferredValue: (value) => value,
		useLayoutEffect: (fn) => fn(),
	},
	"@legendapp/list/reanimated": { AnimatedLegendList: "LegendList" },
	"expo-crypto": {},
	"./hooks": {
		client: memoryApi,
		useCareerQueries: () => ({ facts: { data: [] }, profile: { data: memoryProfile } }),
		useCareerAction: memoryAction,
		useCareerTime: () => ({ when() {}, profile: { data: memoryAccount } }),
		useUndoRows: () => ({ hidden: [] }),
	},
	"./shared": { LoadState: "LoadState" },
	"@/auth/session": memorySession,
});
const factsHeader = () =>
	nodes(render(KnowledgeFacts, { onRefresh: async () => {} })).find((node) => node.type === "LegendList").props
		.ListHeaderComponent;
reset();
for (const memoryMode of ["ask", "auto", "off"]) {
	let header = factsHeader();
	assert.equal(control(header, "Remember facts from my messages").value, memoryProfile.memoryMode);
	control(header, "Remember facts from my messages").onChange(memoryMode);
	control(header, "Remember facts from my messages").onChange(memoryMode);
	header = factsHeader();
	assert.equal(control(header, "Remember facts from my messages").disabled, true);
	assert.equal(calls.length, 1, "pending consent writes cannot repeat");
	assert.deepEqual(calls[0], {
		input: { memoryMode },
		options: { context: { scope: JSON.stringify(["test", "owner"]) } },
	});
	finishMemory();
	await settle();
	assert.equal(control(factsHeader(), "Remember facts from my messages").value, memoryMode);
	assert.equal(memoryProfile.priorities, "Mentoring");
	calls.length = 0;
}
control(factsHeader(), "Remember facts from my messages").onChange("auto");
rejectMemory(new Error("Offline"));
await settle();
assert.equal(control(factsHeader(), "Remember facts from my messages").value, "off");
assert.ok(nodes(factsHeader()).some((node) => node.type === "Banner" && node.props.message === "Offline"));
control(factsHeader(), "Remember facts from my messages").onChange("auto");
finishMemory();
await settle();
assert.equal(control(factsHeader(), "Remember facts from my messages").value, "auto");
assert.equal(
	nodes(factsHeader()).some((node) => node.type === "Banner"),
	false,
);
memoryAccount = undefined;
assert.equal(control(factsHeader(), "Remember facts from my messages").disabled, true);
calls.length = 0;
control(factsHeader(), "Remember facts from my messages").onChange("auto");
assert.equal(calls.length, 0);
memoryAccount = { id: "owner" };
memoryServer = "changed";
control(factsHeader(), "Remember facts from my messages").onChange("auto");
assert.equal(calls.length, 0);
memoryServer = "test";
memoryProfile = undefined;
assert.equal(
	nodes(factsHeader()).some((node) => node.props.label === "Remember facts from my messages"),
	false,
);
console.log("PASS native Facts owns loaded memory consent with scoped writes, pending guard and failure recovery");

const { Preferences: SavingPreferences } = load("features/career/preferences.tsx", {
	react: { ...react, useLayoutEffect: (fn) => fn() },
	"@tanstack/react-query": {
		useQueryClient: () => ({ getQueryData: () => ({ id: "owner" }), invalidateQueries() {} }),
	},
	"@reactive-resume/schema/career": careerSchema,
	"@reactive-resume/utils/amount": amountParser,
	"./hooks": { useCareerTime: () => ({ locale: "en-US", timeZone: "UTC", profile: { data: { id: "owner" } } }) },
	"./role-suggestions": { RoleSuggestions: "RoleSuggestions" },
	"./search-regions-field": { SearchRegionsField: "SearchRegionsField" },
	"@/api/client": {
		client: { career: { updateProfile: async (input, options) => calls.push({ input, options }) } },
		orpc: { auth: { getProfile: { key: () => ["account"] } }, career: { profile: { key: () => ["profile"] } } },
	},
	"@/auth/session": memorySession,
	"@/features/workspace/hooks": {
		useDraft: (_key, initial) => ({
			value: { ...initial, draft: { ...initial.draft, memoryMode: "auto", priorities: "Recovered preference" } },
			blocked: true,
			setBlocked() {},
			clear() {},
		}),
	},
});
reset();
const preferencesTree = render(SavingPreferences, {
	initial: careerSchema.careerProfileDataSchema.parse({ memoryMode: "off" }),
});
assert.equal(
	nodes(preferencesTree).some((node) => node.props.label === "Remember facts from my messages"),
	false,
);
control(preferencesTree, "Retry").onPress();
await settle();
assert.equal(calls[0].input.memoryMode, undefined, "a recovered draft never replays its old memory consent");
assert.equal(calls[0].input.priorities, "Recovered preference");
assert.deepEqual(calls[0].options.context, { scope: JSON.stringify(["test", "owner"]) });
console.log("PASS native recovered Preferences preserves Facts consent and binds its write to the rendered account");

const { useMemoryNote } = load("features/assistant/provider.tsx", {
	"@orpc/client": {},
	"@tanstack/react-query": { useQuery: () => ({ data: { memoryMode: "off" } }) },
	"./chat": {},
	"./chat-view": {},
	"@/api/client": { orpc: { career: { profile: { queryOptions: () => ({}), key: () => ["profile"] } } } },
	"@/auth/session": memorySession,
	"@/features/ai/providers": {},
});
reset();
function MemoryNoteRoute() {
	return useMemoryNote(true).chip;
}
render(MemoryNoteRoute).props.onPress();
assert.deepEqual(calls, [{ pathname: "/career/knowledge", params: { tab: "facts" } }]);
console.log("PASS native coach privacy chip opens Knowledge Facts");

// Follow-up controls must work for every owed row, including accounts larger than the old dismissal cap.
reset();
applicationSearch = "";
needsFollowUpFixture = true;
applications = Array.from({ length: 1001 }, (_, i) => ({ ...job, id: `owed-${i}`, status: "applied" }));
listTree = listView();
const nudgeNodes = (tree) => nodes(nodes(tree).find((node) => node.type === "SectionList").props.ListHeaderComponent);
let nudge = nudgeNodes(listTree).find((node) => node.type === "Banner" && node.props.onDismiss);
assert.ok(nudge);
nudge.props.onDismiss();
listTree = listView();
assert.equal(
	nudgeNodes(listTree).filter((node) => node.type === "Banner" && node.props.onDismiss).length,
	0,
	"one dismissal hides all 1001 owed rows",
);
reset();
applications = applications.slice(0, 2);
listTree = listView();
nudge = nudgeNodes(listTree).find((node) => node.type === "Banner" && node.props.action?.label === "Show");
nudge.props.action.onPress();
needsFollowUpFixture = false;
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(sectionList.props.sections.length, 0);
sectionList.props.ListEmptyComponent.props.action.onPress();
listTree = listView();
sectionList = nodes(listTree).find((node) => node.type === "SectionList");
assert.equal(
	sectionList.props.sections.flatMap((section) => section.data).length,
	2,
	"Clear filters resets follow-up-only too",
);
reset();
needsFollowUpFixture = true;
applications = applications.slice(0, 1);
listTree = listView();
nudge = nudgeNodes(listTree).find((node) => node.type === "Banner" && node.props.action?.label === "Open");
nudge.props.action.onPress();
assert.equal(calls.at(-1), "/applications/owed-0", "single nudge opens Details rather than the Apply tab");
console.log("PASS native full dismissal, follow-up filter clearing and Details navigation");
reset();

// A failed link retries the already-created job, with its original request ID and draft intact.
const nativeCreateRequests = [];
let failNativeLink = true;
let nonce = 0;
const requestIds = load("../../../packages/utils/src/string.ts", { uuid: { v7: () => `native-request-${++nonce}` } });
const nativeDraft = { document: { id: "base-retry" }, status: "saved", locked: false, flush: async () => {} };
let nativeMatchApplication;
const { JobMatch } = load("features/check/job-match.tsx", {
	react: { ...react, useEffect() {}, useMemo: (make) => make() },
	"expo-router": { useRouter: () => ({ ...router, setParams: (params) => calls.push({ routeParams: params }) }) },
	"@/routes": load("routes.ts"),
	"@reactive-resume/utils/string": requestIds,
	"./actions": {},
	"./model": {
		matchPosting: () =>
			nativeMatchApplication
				? { total: 1, found: [], missing: [{ term: "typescript", label: "TypeScript", jdCount: 1, skill: true }] }
				: null,
	},
	"@/api/client": {
		client: {
			applications: {
				create: async (input) => {
					nativeCreateRequests.push(input);
					return "saved-job";
				},
			},
			documents: {
				linkApplication: async () => {
					if (failNativeLink) throw new Error("Offline");
				},
			},
		},
	},
	"@/draft": { useResumeStore: { getState: () => nativeDraft } },
	"@/draft/runtime": { resume: { refresh: async () => {}, blur: async () => {} } },
	"@/features/applications/queries": {
		useApplications: () => ({ data: [] }),
		useApplication: () => ({ data: nativeMatchApplication }),
		useInvalidateApplications: () => () => {},
	},
	"@/features/documents/copy-for-job": {},
});
reset();
const matchView = () =>
	render(JobMatch, { id: "base-retry", data: { metadata: {} }, applicationId: null, locked: false, offline: false });
control(matchView(), "Paste a job posting").onChangeText("Build reliable systems.");
control(matchView(), "Save as a job…").onPress();
control(matchView(), "Company").onChangeText("Retry Co");
control(matchView(), "Role").onChangeText("Engineer");
control(matchView(), "Save and link this resume").onPress();
await settle();
assert.equal(control(matchView(), "Company").value, "Retry Co");
assert.equal(control(matchView(), "Paste a job posting").value, "Build reliable systems.");
failNativeLink = false;
control(matchView(), "Save and link this resume").onPress();
await settle();
assert.equal(nativeCreateRequests.length, 2);
assert.equal(nativeCreateRequests[0].newId, nativeCreateRequests[1].newId, "link retry returns the original job");
assert.equal(control(matchView(), "Paste a job posting").value, "");
console.log("PASS native saved-job link retries retain original ID and draft until success");
reset();
nativeMatchApplication = { id: "selected-job", company: "Cedar", role: "Lead", jobDescription: "TypeScript" };
const selectedMatch = () =>
	render(JobMatch, {
		id: "base-retry",
		data: { metadata: {} },
		applicationId: "selected-job",
		locked: false,
		offline: false,
	});
assert.equal(
	control(selectedMatch(), "Linked application").disabled,
	true,
	"temporary context cannot unlink the other saved job",
);
control(selectedMatch(), "TypeScript").onPress();
control(selectedMatch(), "Ask the assistant to work it in").onPress();
assert.equal(calls.at(-1).params.applicationId, "selected-job", "assistant receives the selected job too");
assert.equal(calls.at(-1).pathname, "/builder/base-retry/assistant");
console.log("PASS native temporary Job match context protects linkage and follows the assistant handoff");

// Shipped Trash controls pass the listed generation and captured account, and never purge after an account switch.
reset();
let trashScope = "account-a";
const trashRequests = [];
const trashItem = { id: "retained", company: "Fictional Cedar", role: "Lead", trashedAt: new Date("2030-01-01") };
let trashTask = Promise.resolve();
const trashKey = () => ["trash"];
const { ApplicationTrashScreen } = load("features/applications/trash-screen.tsx", {
	"./error": { applicationError: (error) => String(error) },
	"@/auth/session": {
		getAccountScope: () => trashScope,
		useSession: () => ({ server: "https://fixture.test", status: "signed-in" }),
	},
	"@tanstack/react-query": {
		useQuery: () => ({ data: { items: [trashItem], total: 1 } }),
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
		useMutation: (options) => ({
			mutate: (input) => {
				trashTask = options
					.mutationFn(input)
					.then(() => options.onSuccess?.())
					.finally(() => options.onSettled?.());
			},
		}),
	},
	"@/api/client": {
		orpc: {
			applications: {
				key: trashKey,
				listTrash: {
					queryOptions: ({ input, context }) => {
						assert.equal(context.scope, trashScope);
						return { queryKey: ["trash", input] };
					},
				},
			},
			career: { key: trashKey },
			documents: { key: trashKey },
			agent: { key: trashKey },
		},
		client: {
			applications: {
				restore: async (input, options) => {
					trashRequests.push({ action: "restore", input, scope: options.context.scope });
				},
				purge: async (input, options) => {
					trashRequests.push({ action: "purge", input, scope: options.context.scope });
				},
			},
		},
	},
});
control(render(ApplicationTrashScreen), "Restore").onPress();
await trashTask;
assert.deepEqual(trashRequests, [
	{ action: "restore", input: { id: "retained", trashedAt: trashItem.trashedAt }, scope: "account-a" },
]);
control(render(ApplicationTrashScreen), "Delete permanently…").onPress();
let trashConfirmation = nodes(render(ApplicationTrashScreen)).find((node) => node.type === "ConfirmDialog").props;
assert.equal(trashConfirmation.hold, true);
trashScope = "account-b";
trashConfirmation.onConfirm();
assert.equal(trashRequests.length, 1, "old account confirmation never dispatches under a new account");
trashScope = "account-a";
trashConfirmation.onConfirm();
await trashTask;
assert.deepEqual(trashRequests.at(-1), {
	action: "purge",
	input: { id: "retained", trashedAt: trashItem.trashedAt },
	scope: "account-a",
});
console.log("PASS native application Trash restore/purge preserve generation, account binding and held confirmation");

// Builder tags use the existing draft/flush owner and leave resume content intact.
reset();
const tagSaves = [];
state = {
	document: {
		id: "menu-tags",
		name: "Cedar resume",
		tags: ["base"],
		isLocked: false,
		data: { basics: { headline: "Portfolio designer" } },
	},
	status: "saved",
	conflict: null,
	updateDocument: (edit) => edit(state.document),
	flush: async () => tagSaves.push(structuredClone(state.document)),
};
const menuStore = Object.assign(() => state, { getState: () => state });
const { DocumentMenu: BuilderDocumentMenu } = load("features/document-menu/index.tsx", {
	"@/features/assistant/translate-resume": { TranslateResume: "TranslateResume" },
	react: { ...react, useEffect() {} },
	"react-native-enriched-html": { EnrichedTextInput: "EnrichedTextInput" },
	"@reactive-resume/resume/sharing": {},
	"@reactive-resume/utils/string": { isolate: (value) => value },
	"@/api/client": { client: {} },
	"@/draft": { useResumeStore: menuStore, resumeFieldFocus: {} },
	"@/features/documents/new-documents": { useNewDocuments: {} },
	"@/features/documents/queries": {
		useDocumentOperations: () => ({
			busy: false,
			run: async (work) => {
				await work();
				return true;
			},
		}),
	},
	"@/features/share/document": document,
	"@/features/share/files": {},
	"@/features/share/revision": {},
	"@/shell/builder-chrome": { useBuilderChrome() {} },
	"@/shell/key-commands": { useKeyCommands() {} },
	"@/ui": { ...ui, IconButton: "IconButton", Sheet: "Sheet" },
});
const { ChipInput: NativeTagInput } = load("ui/fields.tsx", {
	"./theme": { useTheme: () => theme },
	"./icon": {},
	"./layout": {},
	"./motion": {},
	"./overlays": {},
	"./switch": {},
	"./text": {},
	"@reactive-resume/utils/string": {},
});
let tagInputHooks = [];
const menuView = () => render(BuilderDocumentMenu, { id: "menu-tags" });
const menuTagInput = () => {
	const props = control(menuView(), "Tags");
	const parentHooks = hooks;
	hooks = tagInputHooks;
	try {
		const tree = render(NativeTagInput, props);
		tagInputHooks = hooks;
		return tree;
	} finally {
		hooks = parentHooks;
	}
};
const tagsAction = () =>
	nodes(menuView()).find((node) => node.type === "ListRow" && node.props.title === "Tags…").props;
control(menuView(), "Document options").onPress();
assert.equal(tagsAction().disabled, false);
tagsAction().onPress();
control(menuTagInput(), "Tags").onChangeText("portfolio");
menuTagInput();
control(menuView(), "Save").onPress();
await settle();
assert.deepEqual(
	tagSaves.map((saved) => saved.tags),
	[["base"], ["base", "portfolio"]],
);
assert.equal(tagSaves.at(-1).data.basics.headline, "Portfolio designer");
control(menuView(), "Document options").onPress();
tagsAction().onPress();
tagInputHooks = [];
control(menuTagInput(), "Tags").onChangeText("x".repeat(41));
menuTagInput();
const beforeInvalidSave = tagSaves.length;
control(menuView(), "Save").onPress();
await settle();
assert.equal(control(menuView(), "Save").disabled, true);
assert.equal(tagSaves.length, beforeInvalidSave, "unfinished overlong tag cannot reach the draft");
control(menuView(), "Tags").onChange(Array.from({ length: 21 }, (_, index) => `tag-${index}`));
assert.equal(control(menuView(), "Save").disabled, true);
state.document.isLocked = true;
assert.equal(control(menuView(), "Save").disabled, true);
control(menuView(), "Back").onPress();
assert.equal(tagsAction().disabled, true);
console.log("PASS native builder tags use draft flush, retain body, and respect tag limits and locks");

control(menuView(), "Document options").onPress();
nodes(menuView())
	.find((node) => node.type === "ListRow" && node.props.title === "Translate into…")
	.props.onPress();
const menuLanguagePicker = nodes(menuView()).find((node) => node.type === "TranslateResume");
assert.ok(menuLanguagePicker, "Document menu opens the language picker");
assert.equal(menuLanguagePicker.props.resumeId, "menu-tags");
menuLanguagePicker.props.onClose();
assert.equal(
	nodes(menuView()).some((node) => node.type === "TranslateResume"),
	false,
);
console.log("PASS native document menu opens the language picker for its owned resume and closes it");

// Native CSV executes the shared parser; only picker, RPC and sharing cross platform boundaries here.
const csvDomain = load("../../../packages/schema/src/applications/csv.ts", { "./data": applicationData });
let csvScope = "csv-account-a";
let csvPickerResult = { canceled: false, assets: [{ uri: "cache://fictional.csv" }] };
let csvPickedText = "Company,Role\nFictional Cedar,Engineer\n=2,";
let csvPipeline = { revision: 1, lanes: defaultLanes };
let csvServerPipeline = csvPipeline;
let csvRejectImport = false;
let csvImportBarrier = null;
let csvPickerBarrier = null;
let csvMetadataFailure = null;
let csvRefetchFailure = false;
let csvSupported = true;
let csvStageFailure = null;
let csvStageFailed = false;
let csvCleanup;
const csvQuery = () => ({
	isSuccess: !csvMetadataFailure,
	data: csvMetadataFailure ? undefined : { supported: csvSupported, pipeline: csvPipeline },
	lanes: csvPipeline.lanes,
	refetch: async () => {
		if (!csvRefetchFailure) {
			csvMetadataFailure = null;
			csvPipeline = csvServerPipeline;
		}
		return { isSuccess: !csvRefetchFailure };
	},
});
const csvReact = {
	...react,
	useEffect(effect) {
		const mounted = react.useRef(false);
		if (!mounted.current) {
			mounted.current = true;
			csvCleanup = effect();
		}
	},
};
const { ImportApplicationsSheet: NativeCsvImport } = load("features/applications/import-sheet.tsx", {
	react: csvReact,
	"@lingui/core/macro": {
		plural: (value, forms) => (value === 1 ? forms.one : forms.other).replaceAll("#", String(value)),
	},
	"@reactive-resume/schema/applications/csv": csvDomain,
	"@tanstack/react-query": {
		useQueryClient: () => ({
			setQueryData: (_key, value) => {
				csvPipeline = value.pipeline;
			},
		}),
	},
	"expo-document-picker": {
		getDocumentAsync: async () => {
			if (csvPickerBarrier) await csvPickerBarrier;
			return csvPickerResult;
		},
	},
	"expo-file-system": {
		File: class {
			async text() {
				return csvPickedText;
			}
			delete() {
				calls.push("csv-cache-deleted");
			}
		},
	},
	"./lane-queries": {
		useApplicationLanes: csvQuery,
		applicationLanesQueryOptions: () => ({ queryKey: ["csv-lanes"] }),
	},
	"./lanes": lanes,
	"./queries": { useInvalidateApplications: () => async () => calls.push("csv-invalidated") },
	"./stages": stages,
	"@/auth/session": {
		useSession: () => ({ status: "signed-in", server: "csv-server" }),
		getServer: () => "csv-server",
		getAccountScope: () => csvScope,
	},
	"@/api/client": {
		client: {
			applications: {
				lanes: {
					create: async (input, options) => {
						calls.push({ csvStage: input, scope: options.context.scope });
						if (input.expectedRevision !== csvServerPipeline.revision) throw new Error("Stage revision changed");
						if (!csvStageFailed && csvStageFailure === "second-create" && input.label === "Portfolio review") {
							csvStageFailed = true;
							throw new Error("Second stage unavailable");
						}
						const created = {
							...input,
							id: `csv-created-stage-${csvServerPipeline.revision + 1}`,
							position: 7,
							systemKey: null,
							retiredAt: null,
						};
						csvServerPipeline = {
							revision: csvServerPipeline.revision + 1,
							lanes: [...csvServerPipeline.lanes, created],
						};
						if (!csvStageFailed && csvStageFailure === "lost-create-response") {
							csvStageFailed = true;
							throw new Error("Stage committed but reply was lost");
						}
						return csvServerPipeline;
					},
				},
				import: async (input, options) => {
					calls.push({ csvImport: input, scope: options.context.scope, signal: options.signal });
					if (csvImportBarrier) await csvImportBarrier;
					if (csvRejectImport) throw new Error("Import unavailable");
					return { imported: input.items.length };
				},
			},
		},
	},
	"@/features/workspace/share": {
		shareText: async (file, body) => calls.push({ csvShare: { file, body } }),
	},
	"@/ui": { ...ui, Sheet: "Sheet" },
});
reset();
let csvChild = NativeCsvImport({ open: true, onClose: () => calls.push("csv-closed") });
const csvView = () => {
	const sheet = render(csvChild.type, csvChild.props);
	return element("csv-test", {}, sheet, sheet.props.footer);
};
let csvTree = csvView();
control(csvTree, "Upload .csv").onPress();
await settle();
csvTree = csvView();
const csvEditor = control(csvTree, "CSV data");
assert.equal(csvEditor.value, csvPickedText);
assert.equal(csvEditor.minLines, 4);
assert.ok(calls.includes("csv-cache-deleted"));
assert.equal(
	calls.filter((call) => call?.csvImport || call?.csvStage).length,
	0,
	"Review never writes applications or stages",
);
const csvNodes = nodes(csvTree);
assert.ok(
	csvNodes.findIndex((node) => node.type === "Text" && node.props.children.flat().includes("Columns")) <
		csvNodes.findIndex((node) => node.props.label === "CSV data"),
);
control(csvTree, "Download them").onPress();
await settle();
assert.equal(csvDomain.parseCsv(calls.find((call) => call?.csvShare).csvShare.body)[1][0], "'=2");
let csvRelease;
csvImportBarrier = new Promise((resolve) => {
	csvRelease = resolve;
});
control(csvView(), "Import 1 application").onPress();
await settle();
assert.equal(control(csvView(), "Upload .csv").disabled, true);
assert.equal(control(csvView(), "CSV data").editable, false);
csvRelease();
csvImportBarrier = null;
await settle();
assert.deepEqual(calls.find((call) => call?.csvImport).csvImport.items, [
	{ company: "Fictional Cedar", role: "Engineer" },
]);
assert.equal(calls.find((call) => call?.csvImport).scope, "csv-account-a");
assert.ok(calls.includes("csv-closed"));

// Invalid values block saving; leaving that column out uses the corrected shared mapping.
reset();
csvChild = NativeCsvImport({ open: true, onClose() {} });
control(csvView(), "CSV data").onChangeText("Company,Role,Stage\nFictional Elm,Designer,bogus");
assert.equal(control(csvView(), "Import 0 applications").disabled, true);
control(csvView(), "Import 0 applications").onPress();
await settle();
assert.equal(calls.filter((call) => call?.csvImport).length, 0);
control(csvView(), "Column Stage goes to").onChange("");
assert.equal(control(csvView(), "Import 1 application").disabled, false);

// Missing metadata blocks named stages through a failed refresh, preserving the CSV for an explicit retry.
reset();
csvMetadataFailure = "pending";
csvChild = NativeCsvImport({ open: true, onClose() {} });
const csvWithLane = "Company,Role,Lane,Lane Category\nFictional Elm,Designer,Interview,interview";
control(csvView(), "CSV data").onChangeText(csvWithLane);
assert.equal(control(csvView(), "Import 1 application").disabled, true);
csvMetadataFailure = "error";
csvRefetchFailure = true;
control(csvView(), "Retry").onPress();
await settle();
assert.equal(control(csvView(), "CSV data").value, csvWithLane);
assert.equal(control(csvView(), "Import 1 application").disabled, true);
csvRefetchFailure = false;
control(csvView(), "Retry").onPress();
await settle();
assert.equal(control(csvView(), "Import 1 application").disabled, false);
assert.equal(calls.filter((call) => call?.csvImport || call?.csvStage).length, 0);

// A created stage survives an import failure; retry links it instead of creating it again.
reset();
csvChild = NativeCsvImport({ open: true, onClose() {} });
control(csvView(), "CSV data").onChangeText(
	"Company,Role,Lane,Lane Category\nFictional Elm,Designer,Pairing session,interview",
);
assert.equal(control(csvView(), "Import 1 application").disabled, true);
control(csvView(), "Stage Pairing session goes to").onChange("new");
csvRejectImport = true;
control(csvView(), "Import 1 application").onPress();
await settle();
assert.equal(control(csvView(), "Stage Pairing session goes to").value, "csv-created-stage-2");
assert.ok(nodes(csvView()).some((node) => node.props.message === "Import failed. Check the CSV and try again."));
csvRejectImport = false;
control(csvView(), "Import 1 application").onPress();
await settle();
assert.equal(calls.filter((call) => call?.csvStage).length, 1);
assert.equal(calls.filter((call) => call?.csvImport).length, 2);
assert.equal(calls.filter((call) => call?.csvImport).at(-1).csvImport.items[0].laneId, "csv-created-stage-2");

for (const failure of ["second-create", "lost-create-response"]) {
	reset();
	csvPipeline = { revision: 1, lanes: defaultLanes };
	csvServerPipeline = csvPipeline;
	csvStageFailure = failure;
	csvStageFailed = false;
	csvChild = NativeCsvImport({ open: true, onClose() {} });
	const value =
		"Company,Role,Lane,Lane Category\nFictional Elm,Designer I,Pairing session,interview\nFictional Elm,Designer II,Portfolio review,interview";
	control(csvView(), "CSV data").onChangeText(value);
	for (const label of ["Pairing session", "Portfolio review"])
		control(csvView(), `Stage ${label} goes to`).onChange("new");
	control(csvView(), "Import 2 applications").onPress();
	await settle();
	assert.equal(calls.filter((call) => call?.csvImport).length, 0);
	assert.equal(control(csvView(), "CSV data").value, value);
	assert.equal(control(csvView(), "Import 2 applications").disabled, true);
	for (const label of ["Pairing session", "Portfolio review"]) {
		const existing = csvPipeline.lanes.find((lane) => lane.label === label);
		control(csvView(), `Stage ${label} goes to`).onChange(existing?.id ?? "new");
	}
	csvStageFailure = null;
	control(csvView(), "Import 2 applications").onPress();
	await settle();
	for (const label of ["Pairing session", "Portfolio review"])
		assert.equal(csvPipeline.lanes.filter((lane) => lane.label === label).length, 1);
	assert.deepEqual(
		calls.filter((call) => call?.csvStage).map((call) => call.csvStage.expectedRevision),
		failure === "second-create" ? [1, 2, 2] : [1, 2],
	);
	assert.equal(calls.find((call) => call?.csvImport).csvImport.items.length, 2);
}

reset();
csvSupported = false;
csvChild = NativeCsvImport({ open: true, onClose() {} });
control(csvView(), "CSV data").onChangeText(
	"Company,Role,Lane,Lane Category\nFictional Elm,Designer,Custom interview,interview",
);
control(csvView(), "Import 1 application").onPress();
await settle();
assert.deepEqual(calls.find((call) => call?.csvImport).csvImport.items, [
	{ company: "Fictional Elm", role: "Designer", status: "interview" },
]);
assert.equal(
	calls.filter((call) => call?.csvStage).length,
	0,
	"Old servers receive canonical stages without synthetic lane IDs",
);
csvSupported = true;

reset();
csvChild = NativeCsvImport({ open: true, onClose() {} });
control(csvView(), "CSV data").onChangeText(
	"Company,Role\n" + Array.from({ length: 501 }, (_, index) => `Fictional Elm,Role ${index}`).join("\n"),
);
assert.ok(
	nodes(csvView()).some(
		(node) =>
			node.type === "Text" &&
			node.props.children.flat().join("").includes("Only the first 500 rows import at once, leaving out 1."),
	),
);
control(csvView(), "Import 500 applications").onPress();
await settle();
assert.equal(calls.find((call) => call?.csvImport).csvImport.items.length, 500);

reset();
csvChild = NativeCsvImport({ open: true, onClose() {} });
control(csvView(), "CSV data").onChangeText("Company,Role\nPrivate Fictional Job,Engineer");
csvScope = "csv-account-b";
control(csvView(), "Import 1 application").onPress();
await settle();
assert.equal(
	calls.filter((call) => call?.csvImport || call?.csvStage).length,
	0,
	"An account change blocks dispatch of the previous account's CSV",
);
csvCleanup();
csvScope = "csv-account-a";

reset();
csvChild = NativeCsvImport({ open: true, onClose() {} });
let releasePicker;
csvPickerBarrier = new Promise((resolve) => {
	releasePicker = resolve;
});
control(csvView(), "Upload .csv").onPress();
csvScope = "csv-account-b";
releasePicker();
csvPickerBarrier = null;
await settle();
assert.equal(control(csvView(), "CSV data").value, "", "A late picker result cannot publish another account's rows");
assert.ok(calls.includes("csv-cache-deleted"));
csvCleanup();
csvScope = "csv-account-a";

reset();
csvChild = NativeCsvImport({ open: true, onClose: () => calls.push("csv-closed") });
control(csvView(), "CSV data").onChangeText("Company,Role\nFictional Cedar,Engineer");
csvImportBarrier = new Promise((resolve) => {
	csvRelease = resolve;
});
control(csvView(), "Import 1 application").onPress();
await settle();
const departedRequest = calls.find((call) => call?.csvImport);
csvCleanup();
assert.equal(departedRequest.signal.aborted, true);
csvScope = "csv-account-b";
csvRelease();
csvImportBarrier = null;
await settle();
assert.ok(
	!calls.includes("csv-closed") && !calls.includes("csv-invalidated"),
	"A late import response stays with its departed account",
);
csvScope = "csv-account-a";
csvPickerResult = { canceled: true, assets: [] };
console.log(
	"PASS native CSV review-first upload, skipped-row export, explicit import, mapping correction, busy state, stage retry and account-bound dispatch",
);

// Completed contact is a separate action from moving stage or scheduling a reminder.
{
	let job = { ...application, id: "contact-job", status: "applied" };
	let contactPending = false;
	const { ApplicationDetail } = load("features/application-detail/detail-screen.tsx", {
		react: { ...react, useEffect() {} },
		"./hooks": { reminderTargets: () => [], useUserTime: () => ({ date: String, timeZone: "UTC" }) },
		"./interview-sheet": { InterviewSheet: "InterviewSheet" },
		"./sections": Object.fromEntries(
			["Attachments", "Contacts", "Facts", "NextStepCard", "Notes", "StageStepper", "Timeline", "WhatYouSent"].map(
				(name) => [name, name],
			),
		),
		"./sheets": { CloseSheet: "CloseSheet", MarkAppliedSheet: "MarkAppliedSheet", PostingSheet: "PostingSheet" },
		"@/auth/session": { useSession: () => ({ status: "signed-in" }) },
		"@/features/applications/error": { applicationError: String },
		"@/features/applications/stages": stages,
		"@/features/applications/queries": {
			useApplication: () => ({ data: job }),
			useApplicationMutations: () => ({
				update: {},
				remove: {},
				logFollowUp: { isPending: contactPending, mutate: (input) => calls.push({ contact: input }) },
			}),
		},
		"@/features/reminders": {},
	});
	reset();
	tree = render(ApplicationDetail, { id: job.id });
	control(tree, "Followed up").onPress();
	assert.deepEqual(calls.at(-1), { contact: { id: "contact-job" } });
	contactPending = true;
	assert.equal(control(render(ApplicationDetail, { id: job.id }), "Followed up").loading, true);
	for (const status of ["saved", "closed"]) {
		job = { ...job, status };
		assert.equal(
			nodes(render(ApplicationDetail, { id: job.id })).some((node) => node.props.label === "Followed up"),
			false,
		);
	}
}

reset();
applicationSearch = "";
applicationNeedsYou = false;
needsFollowUpFixture = false;
applications = [
	{ ...job, id: "alpha", role: "Alpha", status: "applied", closedReason: null, updatedAt: new Date(), tags: [] },
	{ ...job, id: "beta", role: "Beta", status: "saved", closedReason: null, updatedAt: new Date(), tags: [] },
];
let keyboardTree = listView();
assert.deepEqual(triageBindings, [], "Bare triage starts off");
control(
	nodes(keyboardTree).find((node) => node.type === "SectionList").props.ListHeaderComponent,
	"Keyboard triage",
).onPress();
keyboardTree = listView();
const runTriage = (input) => {
	const command = triageBindings.find((binding) => binding.input === input);
	assert.ok(command, `Missing triage command ${input}`);
	command.run();
	keyboardTree = listView();
};
runTriage("x");
let triageList = nodes(keyboardTree).find((node) => node.type === "SectionList");
assert.equal(triageList.props.extraData.focusedId, "alpha");
assert.deepEqual(triageList.props.extraData.selectedIds, ["alpha"]);
assert.equal(triageList.props.renderItem({ item: applications[0], index: 0 }).props.style.borderWidth, 2);
triageEligible = false;
keyboardTree = listView();
triageList = nodes(keyboardTree).find((node) => node.type === "SectionList");
assert.equal(
	triageList.props.renderItem({ item: applications[0], index: 0 }).props.style.borderWidth,
	0,
	"Suspended registry removes the keyboard focus indicator",
);
triageEligible = true;
keyboardTree = listView();
triageList = nodes(keyboardTree).find((node) => node.type === "SectionList");
assert.equal(
	triageList.props.renderItem({ item: applications[0], index: 0 }).props.style.borderWidth,
	2,
	"Eligibility restoration preserves row identity",
);

runTriage("f");
assert.deepEqual(calls.at(-1), { logFollowUp: { id: "alpha" } });
runTriage("j");
triageList = nodes(keyboardTree).find((node) => node.type === "SectionList");
assert.equal(triageList.props.extraData.focusedId, "beta");
runTriage("f");
assert.equal(calls.filter((call) => call.logFollowUp).length, 1, "Saved rows cannot log contact");
runTriage("4");
assert.equal(calls.at(-1).moveWithUndo.lane.category, "interview");
assert.equal(calls.at(-1).moveWithUndo.applications[0].id, "beta");
runTriage("enter");
assert.equal(calls.at(-1), "/applications/beta");
applications = [applications[0]];
keyboardTree = listView();
const callCount = calls.length;
runTriage("4");
runTriage("f");
runTriage("x");
assert.equal(calls.length, callCount, "A hidden focused row cannot receive a write");
runTriage("j");
triageList = nodes(keyboardTree).find((node) => node.type === "SectionList");
assert.equal(triageList.props.extraData.focusedId, "alpha", "Navigation recovers from a removed identity");
control(
	nodes(keyboardTree).find((node) => node.type === "SectionList").props.ListHeaderComponent,
	"Stop keyboard triage",
).onPress();
listView();
assert.deepEqual(triageBindings, []);
console.log(
	"PASS native triage explicit mode, displayed rows, identity, selection, shared stage/contact owners and hidden-row protection (host)",
);
