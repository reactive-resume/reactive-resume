// Shipped component actions run against native/export/network boundaries; no real account or outbound sharing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mock } from "node:test";
import { i18n } from "@lingui/core";
import * as harness from "./harness.mjs";

i18n.loadAndActivate({ locale: "en-US", messages: {} });

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync } = harness.esbuild;
function loadDomain(path) {
	const output = buildSync({
		entryPoints: [new URL("../../../" + path, import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text;
	const module = { exports: {} };
	new Function("require", "module", "exports", output)(serverRequire, module, module.exports);
	return module.exports;
}

const element = (type, props, ...children) => ({ type, props: { ...props, children } });
// Lingui's t: a tagged template, or a descriptor ({ message, comment }) for strings with translator notes.
const translatedMessages = new Map();
const tag = (parts, ...values) => {
	const text = Array.isArray(parts)
		? parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "")
		: (parts?.message ?? "");
	return translatedMessages.get(text) ?? text;
};
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
	useLayoutEffect() {},
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
// The real route builders (type-only imports), so navigation assertions check the app's actual paths.
const { routes } = harness.load("../src/routes.ts");
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
	"@lingui/core": { i18n },
	"@/api/client": {
		orpc: {
			career: Object.fromEntries(
				["facts", "stories", "savedItems", "notifications", "opportunities", "schedules"].map((name) => [
					name,
					{ key: () => ["career", name] },
				]),
			),
		},
	},
	"@/shell/shortcut-help": {
		ShortcutHelpButton: "ShortcutHelpButton",
		CharacterShortcutSetting: "CharacterShortcutSetting",
		useShortcutHelp: { getState: () => ({ show() {} }) },
	},
	react,
	"react-native": { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", Platform: { OS: "android" } },
	"expo-router": {
		useIsFocused: () => true,
		useRouter: () => router,
		useLocalSearchParams: () => searchParams,
		Stack: { Screen: "StackScreen" },
	},
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { number: i18n.number.bind(i18n), locale: "en-US" } }) },
	"@lingui/core/macro": {
		ph: (named) => Object.values(named)[0],
		t: tag,
		plural: (value, forms) => forms.other.replace("#", String(value)),
	},
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
		useRegisteredKeyCommands: () => triageBindings,
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
// Every source import needs a key here or in `extra`; see ../AGENTS.md.
const load = (path, extra = {}, append = "") =>
	harness.load(`../src/${path}`, { ...mocks, ...extra }, { jsx: "transform", globals: { React: react }, append });
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
for (const format of ["docx", "json"]) {
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
	"expo-web-browser": { openBrowserAsync: async () => {} },
	"@reactive-resume/resume/ats": { lintResumeForAts: () => ({ findings: [] }) },
	"@reactive-resume/resume/cover-letter": {},
	"./document": document,
	"./files": exportBoundary,
	"./letter": {},
	"./model": { safeFileName },
	"@/api/client": { client: {} },
	"@/draft": draftBoundary,
});
reset();
let tree = render(DownloadTab, { resume, offline: false });
holdExport = true;
control(tree, "Share PDF").onPress();
control(tree, "Share PDF").onPress();
await settle();
assert.equal(calls.filter((call) => call?.export).length, 1, "Repeated taps must not duplicate generation");
releaseExport();
await settle();
holdExport = false;
assert.equal(calls.filter((call) => call?.shared === "pdf").length, 1);

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
rejectExport = false;
control(tree, "Share PDF instead").onPress();
await settle();
assert.equal(
	calls.filter((call) => call?.shared === "pdf").length,
	1,
	"Failed alternate format retains a working PDF fallback",
);
console.log("PASS native localized letter query, single-flight/offline/current-document PDF and fallback");

const stages = load("features/applications/stages.ts");
const zod = createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod");
mocks["@reactive-resume/ai/types"] = load("../../../packages/ai/src/types.ts", {
	zod,
	"./defaults": load("../../../packages/ai/src/defaults.ts"),
});
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
let stageUndo;
let stageToastScope = "fixture";
const stageToastOwner = load("features/applications/stage-actions.ts", {
	"./queries": { stageScope: () => stageToastScope },
	"./lane-queries": laneQuery,
	"./lanes": lanes,
	"./stages": stages,
	"@tanstack/react-query": {},
	"@reactive-resume/schema/applications/stage-baselines": {},
	"@/auth/session": {},
	"@/features/applications/error": { applicationError: () => "Link unavailable" },
	"@/features/career/hooks": {},
	"@/features/career/undo": {},
});
const stageActionsStub = {
	useOfferHints: () => undefined,
	offerHintFor: () => offerHint,
	useStageMovedToast: () => {
		const moved = stageToastOwner.useStageMovedToast();
		return (...args) => {
			moved(...args);
			stageUndo = calls.at(-1).undo;
		};
	},
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
let stageUpdate = (input) => calls.push(input);
let stageUpdateAsync = (input) =>
	new Promise((resolve, reject) => stageUpdate(input, { onSuccess: resolve, onError: reject }));
const { StageStepper, NextStepCard, WhatYouSent, Timeline } = load("features/application-detail/sections.tsx", {
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
		useDetailMutations: () => ({
			addNote: {},
			updateEntry: {},
			deleteEntry: {},
		}),
		useNow: () => new Date(),
		useUserTime: () => time,
		followUpReminder: () => null,
		interviewReminder: () => null,
	},
	"./sheets": {
		FollowUpSheet: "FollowUpSheet",
		ReminderSheet: "ReminderSheet",
		TimelineEntrySheet: "TimelineEntrySheet",
	},
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
		useApplicationMutations: () => ({
			update: {
				isPending: false,
				mutate: (...args) => stageUpdate(...args),
				mutateAsync: (...args) => stageUpdateAsync(...args),
			},
		}),
	},
	"./calendar": nativeInterviewCalendar,
	"@/features/reminders": {
		...nativeIcs,
		zonedParts: reminderSchedule.zonedParts,
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
for (const [marker, text, expected, french] of [
	[undefined, "Replied", "Replied"],
	[{ stageEntryId: null }, "Replied", "Followed up · Replied"],
	[{ stageEntryId: null, kind: "reply" }, "Custom contact note", "Replied · Custom contact note"],
	[{ stageEntryId: null, kind: "reply" }, "Replied", "Replied"],
	[{ stageEntryId: null, kind: "reply" }, "Réponse donnée", "Réponse donnée", true],
]) {
	reset();
	if (french) translatedMessages.set("Replied", "Réponse donnée");
	const view = render(Timeline, {
		application: {
			...application,
			activity: [{ id: "contact", type: "note", at: "2030-01-02", text, followedUp: marker }],
		},
		onOpenInterview() {},
	});
	assert.ok(
		nodes(view).some((node) => node.props.title === expected),
		`Canonical native contact label: ${expected}`,
	);
}
console.log("PASS native timeline labels preserve contact kind after note edits");
reset();
tree = render(StageStepper, { application, onMarkApplied: () => calls.push("mark-applied") });
control(tree, "Change lane").onChange("applied");
assert.deepEqual(calls, ["mark-applied"], "Explicit Saved → Applied still captures submission details");
control(tree, "Change lane").onChange("interview");
assert.deepEqual(calls.at(-1), { id: "job-a", status: "interview" });

// Undo must report a rejected inverse, rather than dismissing the success toast in silence.
reset();
stageUpdate = (input, callbacks) => {
	calls.push(input);
	if (input.status === "interview") callbacks?.onSuccess?.();
	else callbacks?.onError?.(new Error("Offline"));
};
tree = render(StageStepper, { application });
control(tree, "Change lane").onChange("interview");
assert.equal(typeof stageUndo, "function");
await stageUndo();
assert.deepEqual(calls.at(-1), { message: "Link unavailable" }, "Detail Undo failure remains visible");
stageUpdate = (input) => calls.push(input);

// A Move sheet can outlive its row snapshot. Resolve the inverse from the cache when its action dispatches.
{
	const { QueryClient, MutationObserver } = mobileRequire("@tanstack/react-query");
	const queryClient = new QueryClient();
	const listKey = ["applications", "stage-fixture"];
	const queryBoundary = {
		applicationsListQueryKey: () => listKey,
		applicationDetailQueryKey: (id) => ["application", id],
		useApplications: () => ({ data: [application], isPending: false, refetch: async () => {} }),
		useApplicationMutations: () => ({
			update: {
				isPending: false,
				mutate: (...args) => stageUpdate(...args),
				mutateAsync: (...args) => stageUpdateAsync(...args),
			},
		}),
	};
	const stageActions = load("features/applications/stage-actions.ts", {
		"./queries": queryBoundary,
		"./lane-queries": laneQuery,
		"./lanes": lanes,
		"./stages": stages,
		"@tanstack/react-query": { useQueryClient: () => queryClient },
		"@reactive-resume/schema/applications/stage-baselines": {},
		"@/auth/session": { getServer: () => "fixture" },
		"@/features/applications/error": { applicationError: () => "Link unavailable" },
		"@/features/career/hooks": {},
		"@/features/career/undo": {},
	});
	const { BoardScreen } = load("features/applications-board/board-screen.tsx", {
		"@tanstack/react-query": { useQueryClient: () => queryClient },
		"react-native": { ...mocks["react-native"], useWindowDimensions: () => ({ width: 320 }) },
		"react-native-gesture-handler": {},
		"react-native-reanimated": {
			...mocks["react-native-reanimated"],
			createAnimatedComponent: () => "Animated.ScrollView",
			useAnimatedReaction() {},
			useAnimatedScrollHandler: () => () => {},
			useFrameCallback: () => ({ setActive() {} }),
		},
		"react-native-worklets": {},
		"./board": load("features/applications-board/board.ts"),
		"./search": { useApplicationSearch: () => ({ search: "", needsYou: false }) },
		"./views": { ApplicationsViewFrame: "ApplicationsViewFrame" },
		"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => time },
		"@/features/application-detail/sheets": { CloseSheet: "CloseSheet", MarkAppliedSheet: "MarkAppliedSheet" },
		"@/features/applications/error": { applicationError: () => "Link unavailable" },
		"@/features/applications/lane-queries": laneQuery,
		"@/features/applications/lanes": lanes,
		"@/features/applications/list": { filterApplications: (rows) => rows },
		"@/features/applications/next-step": nextSteps,
		"@/features/applications/queries": queryBoundary,
		"@/features/applications/stage-actions": { ...stageActionsStub, listedApplication: stageActions.listedApplication },
		"@/shell/use-is-tablet": { useIsTablet: () => false },
	});
	reset();
	const board = BoardScreen().props.children[0].type;
	let boardTree = render(board);
	nodes(boardTree)
		.find((node) => node.type?.name === "Column")
		.props.onMove(application);
	boardTree = render(board);
	queryClient.setQueryData(listKey, [{ ...application, status: "closed", closedReason: "withdrew" }]);
	stageUpdate = (input, callbacks) => {
		calls.push(input);
		if (input.status === "interview") callbacks?.onSuccess?.();
		else callbacks?.onError?.(new Error("Offline"));
	};
	mock.timers.enable({ apis: ["setTimeout"] });
	try {
		nodes(boardTree)
			.find((node) => node.type?.name === "MoveSheet")
			.props.onPick("interview");
		mock.timers.tick(1);
	} finally {
		mock.timers.reset();
	}
	await stageUndo();
	assert.deepEqual(calls.filter((call) => call?.id === application.id).at(-1), {
		id: application.id,
		status: "closed",
		closedReason: "withdrew",
	});
	assert.deepEqual(calls.at(-1), { message: "Link unavailable" }, "Board Undo failure remains visible");

	// Real observer detachment models the useMutation subscription removed when either screen unmounts.
	async function undoAfterUnmount(move, scenario) {
		reset();
		stageToastScope = "fixture";
		stageUndo = undefined;
		let pending;
		let rejectUndo;
		let started;
		const undoStarted = new Promise((resolve) => (started = resolve));
		const observer = new MutationObserver(queryClient, {
			retry: false,
			mutationFn: (input) =>
				input.status === "interview"
					? Promise.resolve(input)
					: new Promise((_resolve, reject) => {
							rejectUndo = reject;
							started();
						}),
		});
		const detach = observer.subscribe(() => {});
		stageUpdate = (input, options) => {
			calls.push(input);
			pending = observer.mutate(input, options);
			void pending.catch(() => {});
		};
		stageUpdateAsync = (input) => {
			calls.push(input);
			pending = observer.mutate(input);
			return pending;
		};
		move();
		if (scenario === "switch-forward") stageToastScope = "another-account";
		await pending;
		if (scenario === "switch-forward") {
			assert.equal(stageUndo, undefined, "An old account's late move cannot show an actionable toast");
			detach();
			return;
		}
		assert.equal(typeof stageUndo, "function");
		if (scenario === "switch-before") {
			stageToastScope = "another-account";
			const writes = calls.filter((call) => call?.id).length;
			await stageUndo();
			assert.equal(calls.filter((call) => call?.id).length, writes, "Old account's toast cannot dispatch Undo");
			detach();
			return;
		}
		const completion = stageUndo();
		await undoStarted;
		detach();
		if (scenario === "switch-during") stageToastScope = "another-account";
		rejectUndo(new Error("Offline"));
		await pending.catch(() => {});
		await completion;
		assert.equal(
			calls.filter((call) => call?.message === "Link unavailable").length,
			scenario === "same-account" ? 1 : 0,
			"Undo failure survives observer unmount, without leaking notices into another account",
		);
	}
	// Detail and board moves share useStageMovedToast, so one entry point proves its account fence.
	for (const scenario of ["same-account", "switch-during", "switch-before", "switch-forward"]) {
		await undoAfterUnmount(
			() => control(render(StageStepper, { application }), "Change lane").onChange("interview"),
			scenario,
		);
	}
	stageToastScope = "fixture";
	queryClient.clear();
	stageUpdate = (input) => calls.push(input);
	stageUpdateAsync = (input) =>
		new Promise((resolve, reject) => stageUpdate(input, { onSuccess: resolve, onError: reject }));
	console.log(
		"PASS explicit stage edits, board Undo resolves its inverse from cache, real mutation observers retain Undo errors after unmount and fence account changes",
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
assert.equal(control(tree, "Use an existing letter").disabled, true);
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
for (const resumeId of [null, "resume-for-letter"]) {
	tree = render(WhatYouSent, { application: { ...application, resumeId } });
	control(tree, "Write a letter").onPress();
	assert.deepEqual(
		calls.at(-1),
		{
			pathname: "/new",
			params: { context: "letters", applicationId: "job-a", ...(resumeId ? { sourceResumeId: resumeId } : {}) },
		},
		"Letter creation opens the reusable document picker with this job and its linked resume",
	);
}
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
time.timeZone = "America/Los_Angeles";
tree = render(NextStepCard, { application: atOffer, onOpenInterview() {} });
control(tree, "Add to calendar").onPress();
await settle();
time.timeZone = "UTC";
assert.equal(calls[0].event.uid, "offer-job-a");
assert.equal(calls[0].event.start.toISOString(), new Date(offerHint.respondBy).toISOString());
assert.ok(calls[0].file.endsWith("2026-11-01.ics"), "calendar filename uses the account's day, not UTC's");
offerHint = undefined;
console.log("PASS native state-aware next actions, offer routes and account-day calendar export");

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
let pendingInterviewReady;
let nativeFormCleanup;
const nativeFormReact = {
	...react,
	useLayoutEffect: (run, deps) => {
		const state = react.useRef({ deps: null });
		if (!state.current.deps || deps.some((value, index) => value !== state.current.deps[index])) {
			nativeFormCleanup?.();
			state.current.deps = deps;
			nativeFormCleanup = run();
		}
	},
};
const nativeInterviewListeners = new Set();
const { prepareRequest: prepareInterviewRequest } = load("../../../packages/utils/src/deferred-request.ts");
const nativeInterviewUndo = load("features/career/undo.ts", {
	"@/auth/session": { getAccountScope: () => interviewScope },
	"react-native": {
		AppState: {
			currentState: "active",
			addEventListener: (_name, run) => {
				nativeInterviewListeners.add(run);
				return { remove: () => nativeInterviewListeners.delete(run) };
			},
		},
	},
	"@/ui": { ...ui, dismissToast() {}, toastLifetime: (value) => value },
});
const { QueryClient: InterviewQueryClient } = mobileRequire("@tanstack/react-query");
const nativeQueryClient = new InterviewQueryClient({
	defaultOptions: { queries: { retry: false, gcTime: Infinity } },
});
const nativeInterviewKey = ["application", nativeJob.id];
let nativeCanonicalRow = nativeJob;
let nativeCanonicalError = false;
let nativeCanonicalReads = 0;
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
	react: nativeFormReact,
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
	"@/features/career/undo": nativeInterviewUndo,
	"@/api/client": {
		prepareRpc: (procedure, input) => {
			const scope = interviewScope;
			return prepareInterviewRequest(async (defer) => {
				await pendingInterviewReady;
				let saved;
				await defer(async () => {
					assert.equal(interviewScope, scope);
					saved = await procedure(input);
					return new Response();
				});
				return saved;
			});
		},
		client: {
			applications: {
				deleteTimelineEntry: async (input) => {
					calls.push({ deleteRound: input });
					if (switchDuringDelete) interviewScope = "another-account";
					if (deleteInterviewError) throw new Error("Unavailable");
					nativeCanonicalRow = { ...nativeCanonicalRow, activity: [] };
				},
			},
		},
	},
	"@/auth/session": { getAccountScope: () => interviewScope },
	"@/features/applications/queries": {
		applicationDetailQueryKey: (id) => ["application", id],
		applicationDetailQueryOptions: (id) => ({
			queryKey: ["application", id],
			queryFn: async () => {
				nativeCanonicalReads++;
				if (nativeCanonicalError) throw new Error("Fictional detail unavailable");
				return nativeCanonicalRow;
			},
		}),
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
	for (const scenario of [
		"undo",
		"hydrated-undo",
		"erased-undo",
		"read-failed-undo",
		"preflight-failed",
		"deleted",
		"unmount-before-ready",
		"background",
		"reminder-failed",
		"delete-failed",
		"switch-before",
		"switch-during",
	]) {
		reset();
		nativeQueryClient.clear();
		nativeCanonicalRow = nativeJob;
		nativeCanonicalReads = 0;
		nativeCanonicalError = scenario === "preflight-failed";
		if (scenario === "hydrated-undo") nativeQueryClient.setQueryData(nativeInterviewKey, nativeJob);
		else assert.equal(nativeQueryClient.getQueryState(nativeInterviewKey), undefined);
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
		let releaseReady;
		pendingInterviewReady =
			scenario === "unmount-before-ready"
				? new Promise((resolve) => {
						releaseReady = resolve;
					})
				: undefined;
		control(renderNativeInterview(), "Delete interview").onPress();
		if (scenario === "unmount-before-ready") {
			nativeFormCleanup?.();
			releaseReady();
		}
		await settle();
		if (scenario === "unmount-before-ready")
			assert.equal(calls.includes("closed"), false, "late deletion does not close the next editor");
		if (scenario === "preflight-failed") {
			assert.equal(
				calls.some((call) => call?.action?.label === "Undo"),
				false,
			);
			assert.equal(
				calls.some((call) => call?.held || call?.deleteRound),
				false,
			);
			assert.equal(calls.includes("closed"), false);
			assert.ok(nativeCanonicalRow.activity.some((entry) => entry.id === nativeRound.id));
			continue;
		}
		assert.equal(calls.find((call) => call?.message)?.action.label, "Undo");
		assert.equal(calls.filter((call) => call?.event).length, 0);
		assert.deepEqual(nativeQueryClient.getQueryData(nativeInterviewKey).activity, []);
		if (scenario.endsWith("undo")) {
			if (scenario === "erased-undo") nativeCanonicalRow = { ...nativeJob, activity: [] };
			nativeCanonicalError = scenario === "read-failed-undo";
			const readsBeforeUndo = nativeCanonicalReads;
			calls.find((call) => call?.message).action.onPress();
			await settle();
			assert.ok(nativeCanonicalReads > readsBeforeUndo, "Undo reads canonical data on cold and hydrated entry points");
			if (nativeCanonicalError) {
				assert.deepEqual(nativeQueryClient.getQueryData(nativeInterviewKey).activity, []);
				nativeCanonicalError = false;
				calls.findLast((call) => call?.action?.label === "Retry").action.onPress();
				await settle();
			}
			assert.deepEqual(
				nativeQueryClient.getQueryData(nativeInterviewKey).activity,
				scenario === "erased-undo" ? [] : [nativeRound],
				"canonical read restores retained identity but never an erased interview's private fields",
			);
		}
		if (scenario === "switch-before") interviewScope = "another-account";
		if (scenario === "background") for (const run of nativeInterviewListeners) run("background");
		commit?.();
		await settle();
		const cancellation = calls.find((call) => call?.action?.label === "Download cancellation");
		if (
			scenario === "deleted" ||
			scenario === "unmount-before-ready" ||
			scenario === "background" ||
			scenario === "reminder-failed"
		) {
			assert.ok(cancellation, "only a committed server delete offers cancellation");
			if (reminderOffError) assert.ok(cancellation.message.includes("Couldn't cancel its device reminder"));
			cancellation.action.onPress();
			await settle();
			const shared = calls.find((call) => call?.event);
			assert.equal(shared.event.uid, nativeRound.id);
			assert.equal(shared.method, "CANCEL");
		} else assert.equal(cancellation, undefined);
		if (scenario.endsWith("undo") || scenario === "switch-before")
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

// Applications list: a row hidden by a filter never stays selected for bulk actions.
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
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { number: i18n.number.bind(i18n), locale: "en" } }) },
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
	"react-native": { View: "View", Pressable: "Pressable", SectionList: "SectionList" },
	"@/ui": { ...ui, Screen: "Screen", EmptyState: "EmptyState", Sheet: "Sheet", SelectSheet: "SelectSheet" },
});
reset();
const List = render(ApplicationsListScreen, {}).type;
const listView = () => render(List, {});
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
applications = [{ ...job, status: "saved" }];
let listTree = listView();
let sectionList = nodes(listTree).find((node) => node.type === "SectionList");
nodes(sectionList.props.renderItem({ item: applications[0] }))
	.find((node) => node.props.icon === "dots-three")
	.props.onPress();
const listRow = () => {
	listTree = listView();
	sectionList = nodes(listTree).find((node) => node.type === "SectionList");
	return nodes(sectionList.props.renderItem({ item: applications[0] })).find((node) => node.type === "ListRow");
};
assert.equal(listRow().props.leading, "check-square", "ellipsis enters explicit bulk selection");
applicationNeedsYou = true;
listRow();
assert.equal(sectionList.props.sections.length, 0, "Needs you hides the selected Saved application");
applicationNeedsYou = false;
assert.equal(listRow().props.leading, "square", "Clearing Needs you never restores a hidden bulk selection");
console.log("PASS Applications filters prune hidden rows from bulk selection");

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
			needsYou: false,
			setNeedsYou() {},
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
// The create link and Save job state don't depend on the current view, so one view proves them.
reset();
createParam = "1";
let frame = render(ApplicationsViewFrame, { current: "board", children: "View" });
let sheet = nodes(frame).find((node) => node.type === "AddApplicationSheet");
assert.ok(sheet, "?create opens Save job in place");
sheet.props.onClose();
assert.deepEqual(setParamsCalls.at(-1), { create: "" }, "close clears create without leaving the view");
createParam = "";
frame = render(ApplicationsViewFrame, { current: "board", children: "View" });
assert.ok(!nodes(frame).some((node) => node.type === "AddApplicationSheet"));
openFromHeader(frame);
frame = render(ApplicationsViewFrame, { current: "board", children: "View" });
sheet = nodes(frame).find((node) => node.type === "AddApplicationSheet");
assert.ok(sheet, "New opens Save job");
sheet.props.onClose();
frame = render(ApplicationsViewFrame, { current: "board", children: "View" });
openFromHeader(frame);
frame = render(ApplicationsViewFrame, { current: "board", children: "View" });
assert.ok(
	nodes(frame).some((node) => node.type === "AddApplicationSheet"),
	"Save job opens again after cancel",
);
// RX-183: CSV import is reachable from the Applications header, as on web.
control(nodes(frame).find((node) => node.type === "CollectionHeader").props.actions, "Import from CSV").onPress();
frame = render(ApplicationsViewFrame, { current: "board", children: "View" });
assert.equal(nodes(frame).find((node) => node.type === "ImportApplicationsSheet").props.open, true);
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
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
	},
	"./date": { parseDateOnly: () => new Date() },
	"@/features/documents/filter": { defaultCopySource: () => undefined },
	"@/features/documents/copy-for-job": {
		copyForJob: async () => {
			throw new Error("No copy requested");
		},
	},
	"@/features/documents/new-documents": { useNewDocuments: { getState: () => ({ markOpened() {} }) } },
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
			ai: { capabilities: { queryOptions: () => ({ queryKey: ["capabilities"] }) } },
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
assert.deepEqual(calls, ["close-draft", "/applications/saved/details"]);
reset();
control(addView(), "Fill details manually").onPress();
control(addView(), "Company").onChangeText("Fictional Labs");
priorLink().onOpen("previous");
discardPrior().onConfirm();
assert.deepEqual(
	calls,
	["close-draft", "/applications/previous/details"],
	"explicit discard opens the prior application",
);
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
const calendarRows = [
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
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { number: i18n.number.bind(i18n), locale: "en-GB" } }) },
	"@lingui/core/macro": {
		ph: (named) => Object.values(named)[0],
		plural: (value, forms) => (forms[value] ?? forms[value === 1 ? "one" : "other"]).replace("#", String(value)),
	},
	"./calendar": nativeCalendar,
	"./search": {
		useApplicationSearch: () => ({
			search: "",
			needsYou: false,
			clearFilters() {},
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

// Manual offers use the production parser; only native widgets, transport and profile loading are boundaries.
const amountParser = load("../../../packages/utils/src/amount.ts");
const careerSchema = load("../../../packages/schema/src/career.ts", {
	zod,
	"./ai-usage": load("../../../packages/schema/src/ai-usage.ts", { zod }),
	"./applications/data": load("../../../packages/schema/src/applications/data.ts", {
		zod,
		"@reactive-resume/utils/timezone": timeParser,
	}),
	"@reactive-resume/utils/region": { searchRegionsSchema: zod.z.array(zod.z.string()).nullable().optional() },
	"@reactive-resume/utils/timezone": timeParser,
});
mocks["@reactive-resume/schema/career-practice"] = load("../../../packages/schema/src/career-practice.ts");
const offerParser = load("../../../packages/schema/src/career-offer.ts", {
	"./career": careerSchema,
	"@reactive-resume/utils/amount": amountParser,
	"@reactive-resume/utils/timezone": timeParser,
});
let offerScope = "offer-account";
let offerLocale = "en-US";
let offerProfile = { isSuccess: false, isPending: true, isError: false };
let offerPreferences;
let savedOffers = [
	{ createdAt: "2026-09-01T00:00:00Z", data: { kind: "offer", currency: "USD" } },
	{ createdAt: "2026-10-01T00:00:00Z", data: { kind: "offer", currency: "GBP" } },
];
let offerApplications = { data: [] };
let loseOfferResponse = false;
let offerFailures = 0;
let holdOfferResponse = false;
let heldOffer;
let offerFocused = true;
const offerLayouts = [];
const offerStorage = new Map();
const nativeOfferSelection = load("features/career/offer-selection.ts", {
	"@/auth/session": { getAccountScope: () => offerScope },
	"zustand/react": {
		create: (initialize) => {
			const store = createRequire(new URL("../../web/package.json", import.meta.url))("zustand/vanilla").createStore(
				initialize,
			);
			return Object.assign((selector) => selector(store.getState()), store);
		},
	},
});
const loadOfferEntry = () =>
	load("features/career/offer-entry.tsx", {
		react: {
			...react,
			useLayoutEffect: (effect) => {
				offerLayouts.push(effect);
			},
		},
		"expo-router": { ...mocks["expo-router"], useIsFocused: () => offerFocused },
		"expo-sqlite/kv-store": {
			getItemSync: (key) => offerStorage.get(key) ?? null,
			setItemSync: (key, value) => {
				offerStorage.set(key, value);
			},
			removeItemSync: (key) => {
				offerStorage.delete(key);
			},
		},
		"./offer-selection": nativeOfferSelection,
		"@reactive-resume/utils/string": load("../../../packages/utils/src/string.ts", { uuid: serverRequire("uuid") }),
		"@/auth/session": { getAccountScope: () => offerScope },
		"@reactive-resume/schema/career": careerSchema,
		"@reactive-resume/schema/career-offer": offerParser,
		"@reactive-resume/utils/amount": amountParser,
		"./hooks": {
			useCareerTime: () => ({ locale: offerLocale, timeZone: "Europe/Berlin", profile: offerProfile }),
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
						if (holdOfferResponse) {
							heldOffer = Promise.withResolvers();
							await heldOffer.promise;
						}
						return { id: "new-version", data: { kind: "offer", ...input.terms } };
					},
				},
			},
			useOffers: () => ({ data: savedOffers }),
			useCareerQueries: () => ({ profile: { data: offerPreferences } }),
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
const { OfferEntry, OfferForm } = loadOfferEntry();
reset();
offerPreferences = { minBase: { amount: 8000, currency: "EUR", period: "month" } };
const annualHintView = render(OfferForm, {
	application: { id: "annual-job", company: "Fictional Salary", role: "Engineer", salary: "$120k–140k" },
	onClose() {},
});
assert.equal(control(annualHintView, "Pay period").value, "year");
assert.equal(control(annualHintView, "Base salary").value, "120000");
reset();
const defaultPeriodView = () =>
	render(OfferForm, { application: { id: "period-job", company: "Fictional Labs", role: "Engineer" }, onClose() {} });
assert.equal(
	control(defaultPeriodView(), "Pay period").value,
	"month",
	"saved Preferences seed the native offer period",
);
offerPreferences = { minBase: { amount: 100, currency: "EUR", period: "hour" } };
assert.equal(
	control(defaultPeriodView(), "Pay period").value,
	"hour",
	"untouched period follows late saved Preferences",
);
control(defaultPeriodView(), "Pay period").onChange("year");
offerPreferences = { minBase: { amount: 8000, currency: "EUR", period: "month" } };
assert.equal(
	control(defaultPeriodView(), "Pay period").value,
	"year",
	"explicit offer period survives later Preferences",
);
offerPreferences = undefined;

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
offerView();
assert.equal(control(offerView(), "Currency").value, "GBP", "starts in the last offer's currency");
savedOffers = [{ createdAt: "2026-11-01T00:00:00Z", data: { kind: "offer", currency: "EUR" } }];
assert.equal(control(offerView(), "Currency").value, "GBP", "late refetch cannot replace the draft currency");
control(offerView(), "Currency").onChange("EUR");
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
control(appliedView(), "Currency").onChange("EUR");
control(appliedView(), "Save offer").onPress();
await settle();
const moved = calls.find((call) => call?.moveWithUndo)?.moveWithUndo;
assert.deepEqual(moved?.applications, [{ id: "job" }]);
assert.equal(moved?.lane.category, "offer");
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
let CurrentOfferForm = OfferForm;
let offerCloses = 0;
const correctedView = () =>
	render(CurrentOfferForm, {
		application: { id: "job", company: "Northwind Labs", role: "Engineer" },
		offer: { id: "original-offer", data: originalTerms },
		onClose() {
			offerCloses++;
		},
	});
assert.equal(control(correctedView(), "Bonus").value, "10%");
control(correctedView(), "Bonus").onChangeText("12.5%");
loseOfferResponse = true;
control(correctedView(), "Save offer").onPress();
await settle();
assert.equal(offerFailures, 1);
assert.equal(calls.length, 1, "lost response keeps the native form open without navigation");
const firstAttempt = calls[0];
CurrentOfferForm = loadOfferEntry().OfferForm;
reset();
control(correctedView(), "Bonus").onChangeText("12.5%");
control(correctedView(), "Save offer").onPress();
await settle();
assert.deepEqual(calls[0], firstAttempt, "restart and re-entry retain the version receipt after a lost response");
assert.match(calls[0].newId, /^[0-9a-f-]{36}$/);
assert.equal(calls[0].id, "original-offer");
assert.equal(calls[0].newVersion, true);
assert.equal(calls[0].terms.variable, null);
assert.equal(calls[0].terms.variablePercent, 12.5);
assert.deepEqual(calls[0].expected, originalTerms);
assert.deepEqual(nativeOfferSelection.useSavedOffer.getState().accounts[offerScope], {
	id: "new-version",
	b: "pinned-offer",
});
assert.ok(!calls.some((call) => call?.params), "form never writes selection to the focused route");
assert.equal(offerCloses, 1);
calls.length = 0;
holdOfferResponse = true;
control(correctedView(), "Save offer").onPress();
await settle();
assert.ok(heldOffer);
offerFocused = false;
correctedView();
for (const effect of offerLayouts.splice(0)) effect();
heldOffer.resolve();
await settle();
assert.equal(offerCloses, 1, "late success cannot close a form after leaving its screen");
assert.ok(
	!calls.some((call) => call?.params || call?.message),
	"late success cannot change another route or toast there",
);
assert.equal(nativeOfferSelection.useSavedOffer.getState().accounts[offerScope].id, "new-version");
holdOfferResponse = false;
offerFocused = true;
correctedView();
for (const effect of offerLayouts.splice(0)) effect();
calls.length = 0;
offerScope = "another-account";
control(correctedView(), "Save offer").onPress();
await settle();
assert.equal(calls.length, 0, "retired native offer form cannot write for the next account");
offerScope = "offer-account";
// The form must hand the account locale to the shared parser: Arabic-Indic percent input stays a percentage.
offerLocale = "ar-SA";
reset();
calls.length = 0;
control(correctedView(), "Bonus").onChangeText("١٢٫٥٪\u061c");
control(correctedView(), "Save offer").onPress();
await settle();
assert.equal(calls[0].terms.variablePercent, 12.5, "native localized percent signs reach the shared version contract");
assert.equal(calls[0].terms.variable, null);
offerLocale = "en-US";
searchParams = {};
console.log("PASS native percentage entry and immutable offer-version action");

// Native Save must stay reachable for validation, then focus the actual missing input.
let storyReadState = {};
const { Stories, StoryEditor } = load("features/career/stories.tsx", {
	"@reactive-resume/schema/career": careerSchema,
	"./hooks": {
		useCareerQueries: () => ({ stories: { data: [], ...storyReadState }, facts: { data: [] } }),
		useUndoRows: () => ({ hidden: [] }),
		useCareerAction: () => ({ pending: false, run: (save) => save() }),
		client: { career: { saveStory: (payload) => calls.push({ story: payload }) } },
	},
	"./story-practice-button": { StoryPracticeButton: "StoryPracticeButton" },
	"./shared": { Actions: "Actions", EditorSheet: "EditorSheet", LoadState: "LoadState", SwitchRow: "SwitchRow" },
});
reset();
for (const state of [{ isPending: true }, { isError: true }]) {
	storyReadState = state;
	reset();
	const tree = render(Stories, {});
	control(tree, "Add a story").onPress();
	assert.ok(nodes(render(Stories, {})).some((node) => typeof node.type === "function" && node.props.story === null));
}
storyReadState = {};
reset();
nodes(render(Stories, {}))
	.find((node) => node.props.action?.label === "Add a story")
	.props.action.onPress();
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
const printedDate = nodes(
	render(DatesField, { dates: { start: "2022-03", end: null, present: false }, locale: "ja-JP", onChange() {} }),
).find((node) => node.props.label === "Start");
reset();
const printedDateField = () => control(render(printedDate.type, printedDate.props), "Start");
assert.equal(printedDateField().value, "2022年3月");
printedDateField().onFocus();
assert.equal(printedDateField().value, "2022-03");
printedDateField().onBlur();
assert.equal(printedDateField().value, "2022年3月");
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
let photoUploadRequest;
const { PictureScreen } = load("features/write/picture-screen.tsx", {
	"@tanstack/react-query": {
		useMutation: (options) => {
			pictureOptions = options;
			return {};
		},
	},
	"expo-file-system": {
		File: class extends Blob {
			constructor(uri) {
				super(["fictional image bytes"]);
				this.uri = uri;
			}
		},
	},
	"expo-image": { Image: "Image" },
	"expo-image-picker": {
		launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: "fixture://photo" }] }),
	},
	"./entry-screen": { EditorScreen: "EditorScreen" },
	"./hooks": { ...photoHooks, useWriteData: (select) => select(photoStore.getState().data) },
	"./pickers": {},
	"./upload": load("features/write/upload.ts", {}),
	"@/api/client": {
		rest: async (path, init) => {
			assert.equal(path, "/files");
			assert.equal(init.method, "POST");
			assert.ok(init.body instanceof FormData);
			photoUploadRequest.started();
			return photoUploadRequest.response;
		},
		client: { storage: { deleteFile: async () => photoBytes.delete(photoUrl) } },
	},
	"@/auth/session": { useSession: () => ({ server: "https://resume.example.test" }) },
	"@/draft": { useResumeStore: photoStore, useIsResumeLocked: () => photoStore.getState().locked },
	"@/draft/native": { nativeEnvironment: { scope: async () => "photo-owner" } },
});
const photoView = () => render(PictureScreen);

for (const action of ["unchanged", "edited", "removed"]) {
	let completeUpload;
	let enterUpload;
	const started = new Promise((resolve) => {
		enterUpload = resolve;
	});
	const response = new Promise((resolve) => {
		completeUpload = resolve;
	});
	photoUploadRequest = { started: enterUpload, response };
	photoStore.getState().update((draft) => {
		draft.picture.url = photoUrl;
		draft.picture.size = 80;
	});
	photoView();
	const pending = pictureOptions.mutationFn();
	await started;
	assert.equal(photoStore.getState().data.picture.url, photoUrl);
	const newerUrl = "https://photos.example.test/newer.jpeg";
	control(photoView(), "Size").onChange(99);
	if (action === "edited") control(photoView(), "URL").onChangeText(newerUrl);
	if (action === "removed") control(photoView(), "Remove photo").onPress();
	const expected =
		action === "unchanged" ? "https://photos.example.test/uploaded.jpeg" : action === "edited" ? newerUrl : "";
	completeUpload({ ok: true, json: async () => ({ url: "https://photos.example.test/uploaded.jpeg" }) });
	await pending;
	assert.equal(photoStore.getState().data.picture.url, expected, `late upload respects ${action} URL`);
	assert.equal(photoStore.getState().data.picture.size, 99, "upload preserves newer appearance edits");
	photoStore.getState().undo();
	assert.equal(photoStore.getState().data.picture.url, photoUrl, "upload or newer choice is one undo step");
	assert.equal(photoStore.getState().data.picture.size, 99, "photo Undo preserves newer appearance edits");
	photoStore.getState().redo();
	assert.equal(photoStore.getState().data.picture.url, expected, "ignored upload does not replace newer history");
}
photoStore.getState().update((draft) => {
	draft.picture.url = photoUrl;
	draft.picture.size = 80;
});
console.log("PASS native photo upload preserves newer URL or removal and unrelated appearance edits");

// Undo removal must retain the edit immediately before it.
photoStore.getState().update((draft) => {
	draft.picture.size = 123;
});
control(photoView(), "Remove photo").onPress();
assert.equal(photoStore.getState().data.picture.url, "");
assert.equal(photoBytes.get(photoUrl), "photo bytes");
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
let todayNow = new Date("2026-11-04T12:00:00Z");
let todaySchedules = [];
const { TodayScreen } = load("features/career/today.tsx", {
	"./prepare-now": { PrepareNow: "PrepareNow" },
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
			schedules: { data: todaySchedules },
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
const completedPreparation = {
	id: "completed-preparation",
	kind: "prepare",
	enabled: true,
	intervalDays: null,
	lastQueuedAt: "2026-10-31T08:00:00Z",
	nextRunAt: "2026-10-31T08:00:00Z",
	lastRun: { status: "completed" },
	timezone: "UTC",
	query: "",
};
for (const [change, expected] of [
	[{}, "Ran 31 Oct · done for this interview"],
	[{ kind: "follow-up" }, "Done · 31 Oct"],
]) {
	todaySchedules = [{ ...completedPreparation, ...change }];
	const tree = render(TodayScreen);
	const text = nodes(tree)
		.filter((node) => node.type === "Text")
		.map((node) => node.props.children.flat(Infinity).join(""));
	assert.ok(text.includes(expected), `Missing schedule status: ${expected}`);
}
todaySchedules = [completedPreparation];
control(render(TodayScreen), "prepare").onValueChange(true);
assert.equal(
	nodes(render(TodayScreen)).find((node) => node.type === "ScheduleSheet").props.schedule,
	completedPreparation,
	"turning a completed one-off on still opens review rather than dispatching another run",
);
todaySchedules = [];
console.log(
	"PASS native completed preparation explains one-interview lifetime and opens review instead of another run",
);

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
todayApplications = [];
todayOffers = [];
console.log(
	"PASS native Today shows simultaneous dated steps, keeps them when offers fail to load and opens the exact workspace tab",
);

todayApplications = [
	{
		...nativeJob,
		status: "interview",
		activity: [{ ...nativeRound, at: "2030-01-03T12:00:00Z" }],
		followUpAt: "2030-01-03T11:00:00Z",
		followUpDateOnly: false,
		followUpNote: "Earlier reminder",
	},
];
const duePreparation = nodes(comingUpView()).find((node) => node.type === "PrepareNow");
assert.equal(duePreparation.props.applicationId, nativeJob.id);
assert.equal(duePreparation.props.interviewId, nativeRound.id);
todayApplications = [];

reset();
const preparationJob = {
	...nativeJob,
	status: "interview",
	company: "Fictional Cedar",
	activity: [{ ...nativeRound, at: "2030-01-03T12:00:00Z" }],
};
let preparationQuery = { data: preparationJob, isError: false };
let preparationProvider = { id: "fictional-provider" };
let finishPreparation;
let failPreparation;
const preparationGeneration = {
	isPending: false,
	failure: null,
	data: undefined,
	run: (task) => {
		calls.push({ task });
		return new Promise((resolve, reject) => {
			finishPreparation = resolve;
			failPreparation = reject;
		});
	},
};
const preparationModule = load("features/career/prepare-now.tsx", {
	"./shared": { LoadState: "LoadState" },
	"./hooks": { useNow: () => todayNow, useCareerTime: () => ({ when: (at) => `Round ${at}` }) },
	"./scheduling": load("features/career/scheduling.ts", { "@reactive-resume/utils/timezone": timeParser }),
	"@/features/ai/providers": { useHasAIProvider: () => ({ defaultProvider: preparationProvider }) },
	"@/features/applications/queries": {
		useApplication: () => preparationQuery,
		useApplications: () => ({ data: [preparationJob] }),
	},
	"@/features/workspace/hooks": {
		useGenerate: (id) => {
			assert.equal(id, preparationJob.id);
			return preparationGeneration;
		},
	},
	"@/features/workspace/parts": { AiNotice: "AiNotice", GenerateNotice: "GenerateNotice" },
	"@/features/workspace/shell": {
		workspaceHref: (id, tab, search) => {
			calls.push({ destination: { id, tab, search } });
			return `/applications/${id}/${tab}`;
		},
	},
});
const preparationView = () =>
	render(preparationModule.PrepareNow, {
		applicationId: preparationJob.id,
		interviewId: nativeRound.id,
		now: todayNow,
	});
control(preparationView(), "Generate briefing now").onPress();
control(preparationView(), "Generate briefing now").onPress();
assert.deepEqual(calls, [{ task: { task: "briefing", interviewId: nativeRound.id } }]);
failPreparation(new Error("Fictional offline request"));
await settle();
control(preparationView(), "Generate briefing now").onPress();
finishPreparation({ item: { id: "briefing" } });
await settle();
assert.equal(calls.length, 2, "failed request can be retried without duplicate dispatch");
preparationProvider = null;
assert.equal(control(preparationView(), "Generate briefing now").disabled, true);
control(preparationView(), "Practice 3 questions").onPress();
assert.deepEqual(calls.findLast((entry) => entry?.destination).destination, {
	id: preparationJob.id,
	tab: "practise",
	search: { round: nativeRound.id, warmup: true },
});
reset();
control(render(preparationModule.PracticeHandoff), "Practice in Fictional Cedar’s workspace").onPress();
assert.deepEqual(calls.find((entry) => entry?.destination).destination, {
	id: preparationJob.id,
	tab: "practise",
	search: { round: nativeRound.id, warmup: true },
});
preparationQuery = { data: undefined, isError: true };
assert.equal(preparationView().type, "LoadState");
console.log(
	"PASS native Today offers immediate briefing for a due round behind an earlier reminder; briefing shares disclosed owned context, guards repeats and retries; Today/Coach handoffs target the same warm-up round without a provider",
);

const { DraftConflictSheet } = load("draft/conflict-sheet.tsx", {
	"./runtime": {},
	"react-native": { ...mocks["react-native"], Modal: "Modal" },
	"react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
});
{
	reset();
	const props = {
		open: true,
		kind: "resume",
		name: "Fictional document",
		locked: false,
		reason: "CURRENT_CLIENT_REQUIRED",
		onResolve: async (choice) => calls.push(choice),
	};
	const refused = render(DraftConflictSheet, props);
	control(refused, "Keep both").onPress();
	await settle();
	assert.deepEqual(calls, ["keep-both"]);
	control(refused, "Use saved version").onPress();
	await settle();
	assert.deepEqual(calls, ["keep-both"], "Use saved version alone discards nothing");
	const dialog = nodes(render(DraftConflictSheet, props)).find((node) => node.type === "ConfirmDialog");
	assert.equal(dialog.props.open, true);
	dialog.props.onConfirm();
	await settle();
	assert.equal(calls.at(-1), "use-theirs");
}
console.log("PASS native older-draft recovery keeps both directly and loads the saved version only after confirmation");

let headerSaved = { data: undefined, isPending: true, isError: false, refetch: () => calls.push("retry-saved") };
let headerApplication = { ...application, status: "offer", company: "Context job", role: "Engineer" };
let headerCurrentInterview;
const { WorkspaceScreen, workspaceHref } = load("features/workspace/shell.tsx", {
	"@reactive-resume/schema/career": careerSchema,
	"./coach-sheet": { CoachSheet: "CoachSheet" },
	"./hooks": {
		useSavedItems: () => headerSaved,
		useWorkspace: () => ({ isPending: false, query: { isError: false, data: {}, refetch: () => {} } }),
	},
	"./logic": { currentInterview: () => headerCurrentInterview },
	"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => time },
	"@/features/application-detail/interview-sheet": { InterviewSheet: "InterviewSheet" },
	"@/features/applications/error": { applicationError: String },
	"@/features/applications/lane-queries": laneQuery,
	"@/features/applications/lanes": lanes,
	"@/features/applications/queries": {
		useApplication: () => ({
			data: headerApplication,
			isPending: false,
		}),
	},
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
headerSaved = { ...headerSaved, isError: false, data: [{ id: "context-latest", data: { kind: "offer" } }] };
const loadedHeader = control(workspaceHeader().header, "Compare offers");
assert.equal(loadedHeader.disabled, false);
loadedHeader.onPress();
assert.deepEqual(calls.at(-1), { pathname: "/career/offers", params: { a: "context-latest" } });
console.log("PASS native contextual offers gated cold/error and retain latest offer when loaded");

const quickPracticeUrl = new URL(
	workspaceHref("fictional-job", "practise", { round: "round & one", warmup: true }),
	"https://fictional.invalid",
);
assert.equal(quickPracticeUrl.pathname, "/applications/fictional-job/practise");
assert.deepEqual(Object.fromEntries(quickPracticeUrl.searchParams), { warmup: "1", round: "round & one" });
headerApplication = { ...headerApplication, activity: [nativeRound] };
headerCurrentInterview = { ...nativeRound, id: "other-round" };
const practiceProps = () => {
	reset();
	let props;
	render(WorkspaceScreen, {
		tab: "practise",
		children: (value) => {
			props = value;
			return null;
		},
	});
	return props;
};
searchParams = { id: headerApplication.id, warmup: "1", round: nativeRound.id };
assert.equal(practiceProps().interview.id, nativeRound.id);
assert.equal(practiceProps().warmup, true);
practiceProps().go("prepare");
assert.equal(calls.at(-1), `/applications/${headerApplication.id}/prepare?round=${nativeRound.id}`);
searchParams = { ...searchParams, round: "removed-round" };
assert.equal(practiceProps().interview, undefined, "quick Practice must not switch to another round after removal");
searchParams = { id: headerApplication.id, round: "removed-round" };
assert.equal(
	practiceProps().interview.id,
	"other-round",
	"ordinary workspace navigation retains its existing fallback",
);
searchParams = {};
console.log(
	"PASS native quick Practice URL encoding and screen parsing pin the requested round without changing ordinary navigation",
);

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
const { SetUpWebAccess: nativeWebSetup } = load("features/ai/web-access.tsx", {
	"@orpc/client": {},
	"@tanstack/react-query": {},
	"./error": {},
	"./providers": {},
	"@/auth/session": {},
});
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
	"@/features/ai/web-access": { SetUpWebAccess: nativeWebSetup },
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
const discoveryForm = render(ScheduleSheet, { schedule: null, kind: "discovery", onClose() {}, onDelete() {} });
const setupControl = nodes(render(discoveryForm.type, discoveryForm.props)).find(
	(node) => node.type === nativeWebSetup,
);
assert.ok(setupControl, "Discovery offers web setup inside its sheet");
reset();
const webSetupView = () => render(setupControl.type, setupControl.props);
control(webSetupView(), "Set up web access").onPress();
assert.equal(nodes(webSetupView()).find((node) => node.props.title === "Web access").props.open, true);
assert.deepEqual(calls, [], "Web setup never navigates away from the unsaved schedule");
console.log("PASS native discovery opens web setup in place without leaving its unsaved schedule");

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
			getProposalState: () => "pending",
			blockText: (text) => text,
		},
		"./actions": {},
		"./issues": { getSectionName: () => "Summary" },
		"./review": {
			mapWritingReview: () => ({
				proposals: [
					{ id: "saved-rewrite", before: "Fictional original", after: "Fictional rewrite", status: "pending" },
				],
				notes: [],
			}),
		},
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
		"@/features/ai/usage": { AiResultUsage: "ResultUsage" },
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
		aiOperationIds: ["saved-writing-source"],
		aiUsage: {
			requests: 2,
			models: [{ providerId: "old-provider", label: "Recorded AI", provider: "openai", model: "recorded-model" }],
		},
	};
	render(Writing, writingProps);
	assert.equal(publishedWriting.summary, "Latest saved");
	assert.deepEqual(publishedWriting.proposals[0].aiOperationIds, ["saved-writing-source"]);
	writingProps.review = publishedWriting;
	assert.deepEqual(
		nodes(render(Writing, writingProps)).find((node) => node.type === "ResultUsage").props.usage,
		savedWriting.aiUsage,
	);
	resolveOld({ summary: "Older discarded response" });
	await settle();
	assert.equal(publishedWriting.summary, "Latest saved");
	assert.deepEqual(publishedWriting.proposals[0].aiOperationIds, ["saved-writing-source"]);
	assert.deepEqual(
		calls,
		[["writing", "resume-a"]],
		"An unmounted canceled request cannot publish or invalidate a different document",
	);
	delete savedWriting.aiOperationIds;
	savedWriting.reviewedAt = new Date("2030-01-01T00:00:03Z");
	render(Writing, writingProps);
	assert.equal(publishedWriting.proposals.length, 1);
	assert.equal(publishedWriting.proposals[0].aiOperationIds, undefined, "Older source-less reviews remain usable");
	assert.equal(writingRequest, 2, "Hydration never repeats generation");
	console.log(
		"PASS native Writing publishes only the saved review with its sources and usage, ignores unmounted responses and never regenerates on hydration",
	);

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
		"@/auth/session": { getAccountScope: () => "fixture" },
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
	control(fitTree, "Check fit").onPress();
	control(fitTree, "Resume to use as evidence").onChange("chosen");
	fitTree = render(fitComponent, fitProps);
	control(fitTree, "Use this resume as evidence").onPress();
	assert.equal(linkedResume, "chosen", "Fit links only the user's explicit resume choice");
	console.log("PASS native Fit sends no request without evidence and links only the explicitly chosen resume");
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
let pdfReview;
const { NewDocument } = load("features/documents/new-document.tsx", {
	"@reactive-resume/utils/locale": loadDomain("packages/utils/src/locale.ts"),
	"@/features/settings/locale-names": { getLocaleOptions: () => [{ value: "de-DE", label: "Deutsch" }] },
	"@/i18n": { selectableLocales: ["en-US", "de-DE"] },
	"./copy-for-job": {
		copyForJob: async (input) => {
			calls.push(input);
			return "copy";
		},
	},
	"./filter": { defaultCopySource: (rows) => rows.find((row) => !row.applicationId) ?? rows[0] },
	react: { ...react, useEffect() {} },
	"@tanstack/react-query": { useQuery: () => copyApplications },
	"expo-document-picker": {
		getDocumentAsync: async () => ({ canceled: false, assets: [{ name: "Fictional.pdf", uri: "fixture" }] }),
	},
	"expo-file-system": {
		File: class {
			delete() {}
		},
	},
	"expo-network": { getNetworkStateAsync: async () => ({ isConnected: true }) },
	"expo-router": {
		useRouter: () => ({ replace: (href) => calls.push(href) }),
		useLocalSearchParams: () => newDocumentParams,
		Stack: { Screen: "StackScreen" },
	},
	"@reactive-resume/schema/resume/dates": {},
	"./import-file": { ImportError: class extends Error {}, importDocument: async () => pdfReview },
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
for (const compared of [false, true]) {
	reset();
	newDocumentParams = { step: "import" };
	pdfReview = {
		type: "review",
		compared,
		partial: true,
		review: { sections: [], missingContact: false, notImported: compared ? ["Fictional omitted line"] : [] },
	};
	nodes(render(NewDocument))
		.find((node) => node.props.title === "Import a resume")
		.props.onPress();
	control(render(NewDocument), "Choose a file").onPress();
	await settle();
	control(render(NewDocument), "Import file").onPress();
	await settle();
	const view = JSON.stringify(render(NewDocument));
	assert.match(view, /Check what was found/);
	if (compared) {
		assert.match(
			view,
			/Only part of this file could be compared with what came in. Check each section against your file in the editor./,
		);
		assert.match(view, /Fictional omitted line/);
	} else {
		assert.match(view, /This file's text couldn't be compared with what came in/);
		assert.doesNotMatch(view, /Only part of this file could be compared/);
	}
}
newDocumentParams = { step: "copy", applicationId: "new-job" };
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
console.log(
	"PASS native PDF import review says whether its source was compared; copy waits for the selected job and preserves its application ID",
);

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
control(render(NewDocument), "New cover letter").onPress();
await settle();
assert.deepEqual(calls, [
	{ createdLetter: { name: "Untitled letter", recipient: "", content: "" } },
	"/letter/letter-new/write",
]);
console.log("PASS native letter entry creates an untitled letter and opens its Write screen");

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
{
	const locale = "de-DE";
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
}
console.log("PASS native saved Preferences amount round-trips in a comma-decimal locale");

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
	getAccountScope: () => JSON.stringify([memoryServer, memoryAccount?.id]),
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
let factsReadState = {};
const { Facts: KnowledgeFacts } = load("features/career/facts.tsx", {
	"@tanstack/react-query": {},
	"@reactive-resume/schema/career": careerSchema,
	"@/features/applications/queries": {
		useApplications: () => ({ data: [{ id: "cedar", company: "Fictional Cedar", role: "Engineer" }] }),
	},
	"@/api/client": { client: memoryApi, orpc: memoryOrpc },
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
		useCareerQueries: () => ({ facts: { data: [], ...factsReadState }, profile: { data: memoryProfile } }),
		useCareerAction: memoryAction,
		useCareerTime: () => ({ when() {}, profile: { data: memoryAccount } }),
		useUndoRows: () => ({ hidden: [] }),
	},
	"./shared": { LoadState: "LoadState", EditorSheet: "EditorSheet" },
	"@/auth/session": memorySession,
});
const factsHeader = () =>
	nodes(render(KnowledgeFacts, { onRefresh: async () => {} })).find((node) => node.type === "LegendList").props
		.ListHeaderComponent;
reset();
for (const state of [{ isPending: true }, { isError: true }]) {
	factsReadState = state;
	reset();
	control(factsHeader(), "Add a fact").onPress();
	assert.ok(
		nodes(render(KnowledgeFacts, { onRefresh: async () => {} })).some(
			(node) => typeof node.type === "function" && node.props.fact === null,
		),
	);
}
factsReadState = {};
reset();
{
	const memoryMode = "off";
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
console.log(
	"PASS native Facts adds facts while the list is loading or failed; memory consent writes are scoped and single-flight, recover from failure and stop without an account or after a server change",
);

reset();
const emptyFact = nodes(factsHeader()).find((node) => node.props.title === "No facts yet");
assert.ok(emptyFact);
emptyFact.props.action.onPress();
const nativeFactEditor = nodes(render(KnowledgeFacts, { onRefresh: async () => {} })).find(
	(node) => typeof node.type === "function" && node.type.name === "FactEditor",
).type;
reset();
memoryAccount = { id: "owner" };
let finishCorrection;
let failCorrection;
memoryApi.career.correctFact = (input, options) => {
	calls.push({ input, options });
	return new Promise((resolve, reject) => {
		finishCorrection = resolve;
		failCorrection = reject;
	});
};
const correctingFact = { id: "fact", text: "Fictional mentoring result", category: "experience", applicationId: null };
const nativeCorrectionProps = { fact: correctingFact, onClose: () => calls.push("correction-closed") };
const nativeCorrectionView = () => render(nativeFactEditor, nativeCorrectionProps);
control(nativeCorrectionView(), "Type").onChange("skill");
control(nativeCorrectionView(), "Scope").onChange("cedar");
assert.equal(nativeCorrectionView().props.dirty, true, "metadata corrections participate in the dirty form guard");
control(nativeCorrectionView(), "Save fact").onPress();
control(nativeCorrectionView(), "Save fact").onPress();
assert.deepEqual(
	calls,
	[
		{
			input: {
				id: "fact",
				before: { text: correctingFact.text, category: "experience", applicationId: null },
				category: "skill",
				applicationId: "cedar",
			},
			options: { context: { scope: JSON.stringify(["test", "owner"]) } },
		},
	],
	"one atomic scoped metadata request; unchanged text is not overwritten",
);
failCorrection(new Error("Older server has no correction route"));
await settle();
assert.equal(control(nativeCorrectionView(), "Type").value, "skill");
assert.equal(control(nativeCorrectionView(), "Scope").value, "cedar");
assert.ok(nodes(nativeCorrectionView()).some((node) => node.type === "Banner"));
assert.equal(calls.includes("correction-closed"), false, "failed correction retains the draft");
control(nativeCorrectionView(), "Save fact").onPress();
finishCorrection();
await settle();
assert.equal(calls.filter((entry) => entry === "correction-closed").length, 1);
console.log(
	"PASS native fact correction sends one atomic scoped metadata request, joins the dirty guard and retains type and scope through a failed save until retry",
);

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
assert.equal(calls.at(-1), "/applications/owed-0/details", "single nudge opens Details rather than the Apply tab");
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

hooks = [];
let suggestedTags = ["chosen"];
const suggestedCommit = { current: null };
const suggestedView = () =>
	render(NativeTagInput, {
		label: "Tags",
		values: suggestedTags,
		onChange: (next) => {
			suggestedTags = next;
		},
		suggestions: ["remote"],
		commitRef: suggestedCommit,
	});
control(suggestedView(), "Tags").onChangeText("rem");
control(suggestedView(), "remote").onPress();
suggestedView();
assert.deepEqual(suggestedCommit.current(), ["chosen", "remote"], "suggestion consumes its typed filter before Save");
console.log("PASS native filtered tag suggestion never saves the filter as another tag");

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
		ph: (named) => Object.values(named)[0],
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
assert.ok(calls.includes("csv-cache-deleted"));
assert.equal(
	calls.filter((call) => call?.csvImport || call?.csvStage).length,
	0,
	"Review never writes applications or stages",
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
// Rows past the cap are left out, so the sheet says so before importing.
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
	"PASS native CSV review-first upload, formula-safe skipped-row export, explicit import, mapping correction, busy state, metadata retry, stage retry without duplicates, old-server stages, 500-row cap and account-bound dispatch",
);

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
assert.equal(calls.at(-1), "/applications/beta/details");
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

// Request provenance travels with the accepted draft; Undo restores the prior content's sources.
reset();
let provenanceAnswer = {
	id: "answer-provenance",
	question: "What did you build?",
	answer: "Original answer.",
	factIds: [],
	aiOperationIds: ["prior-op"],
};
const provenanceSaves = [];
const { AnswerCard: NativeAnswerCard } = load(
	"features/workspace/tabs/apply.tsx",
	{
		react: { ...react, useLayoutEffect: (effect) => effect() },
		"@tanstack/react-query": {},
		"expo-clipboard": {},
		"expo-crypto": {},
		"@reactive-resume/schema/application-answers": { answerLimit: () => null },
		"@reactive-resume/schema/applications/data": {},
		"@reactive-resume/schema/applications/preparation": {},
		"@reactive-resume/schema/career": careerSchema,
		"@reactive-resume/utils/string": { rewriteSummary: () => ({ words: 0, removed: 0, added: 0 }) },
		"../answer-library": { AnswerLibrary: "AnswerLibrary" },
		"../hooks": {
			useDraft: (_key, value) => {
				const [text, setText] = react.useState(value);
				return { value: text, setValue: setText, clear() {}, restored: false };
			},
			useGenerate: () => ({
				run: async () => ({ answer: { text: "Generated answer.", factIds: [], aiOperationIds: ["next-op"] } }),
				isPending: false,
			}),
			useAutosave: () => ({ flush() {} }),
		},
		"../logic": {
			countWords: (text) => text.split(/\s+/).length,
			countCharacters: (text) => [...text].length,
			diffWords: (_before, after) => [{ type: "added", text: after }],
			shortLabel: (text) => text,
		},
		"../parts": {
			Block: "Block",
			Actions: "Actions",
			GenerateNotice: "GenerateNotice",
			SaveError: "SaveError",
			workingSteps: () => [],
			useWorking: (_busy, _steps, label) => label,
		},
		"../prepare-review": { PrepareReview: () => null },
		"../preparation": {},
		"../share": {},
		"../shell": {},
		"../state": {},
		"@/api/client": {},
		"@/auth/session": { getAccountScope: () => "fixture" },
		"@/draft": {},
		"@/features/ai/providers": { useHasAIProvider: () => ({ defaultProvider: { id: "fixture" } }) },
		"@/features/application-detail/sections": {},
		"@/features/applications/prior-no-response": {},
		"@/features/applications/queries": {},
		"@/features/career/undo": {},
		"@/features/documents/queries": {},
		"@/ui": { ...ui, Sheet: "Sheet" },
	},
	"\nmodule.exports.AnswerCard=AnswerCard;",
);
const provenanceView = () =>
	render(NativeAnswerCard, {
		answer: provenanceAnswer,
		facts: [],
		applicationId: "job-a",
		company: "Fictional Harbor",
		readOnly: false,
		disabled: false,
		registerDraft: () => () => {},
		fetchServer: async () => provenanceAnswer,
		onRemove() {},
		unit: "words",
		onToggleUnit() {},
		onSave: async (patch, expected) => {
			provenanceSaves.push({ patch, expected });
			provenanceAnswer = { ...provenanceAnswer, ...patch };
			return { ok: true };
		},
	});
control(provenanceView(), "Tighten").onPress();
await settle();
control(provenanceView(), "Accept").onPress();
await settle();
assert.deepEqual(provenanceSaves[0].patch.aiOperationIds, ["prior-op", "next-op"]);
provenanceView();
const provenanceUndo = calls.findLast((call) => call?.message === "Answer replaced").action;
await provenanceUndo.onPress();
await settle();
assert.deepEqual(provenanceSaves[1].patch.aiOperationIds, ["prior-op"]);
assert.deepEqual(provenanceSaves[1].expected.aiOperationIds, ["prior-op", "next-op"]);
console.log("PASS native answer Accept/Undo preserves actual request sources with the reviewed content");

reset();
provenanceAnswer = { ...provenanceAnswer, question: "Original question from form" };
provenanceView();
provenanceAnswer = { ...provenanceAnswer, question: "Corrected question from another device" };
provenanceView();
assert.equal(
	nodes(provenanceView()).find((node) => node.type === "Block").props.title,
	"Corrected question from another device",
	"Canonical question correction replaces an untouched native draft instead of autosaving the old wording",
);
console.log("PASS native canonical question wording updates an untouched draft");

// Letter History restores the selected version; a late restore cannot notify a replacement editor.
const rx233Letter = { id: "birch-letter", isLocked: false };
let rx233Versions = [];
let rx233Current = true;
let rx233Restore;
const { LetterShareSheet: rx233Share } = load("features/letters/share.tsx", {
	"./compose": {},
	"./page": {},
	"./queries": {},
	"./save": {
		restoreLetterVersion: async (...input) => {
			rx233Restore = input;
			return rx233Current;
		},
	},
	"@/api/client": { client: {}, orpc: { coverLetters: { listVersions: { queryOptions: (options) => options } } } },
	"@/draft": { useLetterStore: (select) => select({ document: rx233Letter }) },
	"@/features/ai/usage": {},
	"@/features/documents/queries": {
		useDocumentOperations: () => ({
			busy: false,
			run: async (operation) => {
				await operation();
				return true;
			},
		}),
	},
	"@/features/share/files": {},
	"@/features/share/letter": {},
	"@/features/share/model": {},
	"@reactive-resume/utils/file": {},
	"expo-network": { useNetworkState: () => ({ isConnected: true, isInternetReachable: true }) },
	"@tanstack/react-query": { useQuery: () => ({ data: rx233Versions, refetch: async () => undefined }) },
});
for (const current of [true, false]) {
	rx233Current = current;
	rx233Versions = [{ id: "birch-version", name: "Birch version A", kind: "named", createdAt: new Date() }];
	reset();
	const sheet = render(rx233Share, { id: rx233Letter.id, open: true, onClose() {}, version: "birch-version" });
	const history = nodes(sheet).find((node) => node.type?.name === "LetterHistory");
	assert.ok(history, "Letter share routes the selected version to History");
	reset();
	let tree = render(history.type, history.props);
	control(tree, "Restore this version").onPress();
	tree = render(history.type, history.props);
	nodes(tree)
		.find((node) => node.type === "ConfirmDialog")
		.props.onConfirm();
	await settle();
	assert.deepEqual(rx233Restore.slice(0, 2), [rx233Letter.id, "birch-version"]);
	assert.equal(
		calls.some((call) => call.message),
		current,
		current ? "A current restore confirms itself" : "Late restore cannot notify a replacement editor",
	);
}
console.log("PASS native letter History restores the selected version and fences its notice from a replacement editor");

// Recovered document-language/assistant acceptance runs actual native owners against upload/storage/write boundaries.
const pasteFiles = new Map();
class PasteFile {
	constructor(root, name) {
		this.uri = name ? `${root}/${name}` : root;
	}
	write(text) {
		pasteFiles.set(this.uri, text);
	}
	get exists() {
		return pasteFiles.has(this.uri);
	}
	get size() {
		return Buffer.byteLength(pasteFiles.get(this.uri) ?? "");
	}
	async base64() {
		return Buffer.from(pasteFiles.get(this.uri) ?? "").toString("base64");
	}
	delete() {
		pasteFiles.delete(this.uri);
	}
}
let pasteUpload;
let polishScope = "polish-account";
const polishBoundaries = {
	react: { ...react, memo: (component) => component },
	"@legendapp/list/react-native": {},
	ai: {},
	"@orpc/client": { ORPCError: class extends Error {} },
	"expo-clipboard": {},
	"expo-document-picker": {},
	"expo-file-system": { File: PasteFile, Paths: { cache: "own-cache" } },
	"react-native-keyboard-controller": {},
	"react-native": { View: "View", Pressable: "Pressable", ScrollView: "ScrollView", TextInput: "TextInput" },
	"@reactive-resume/ai/tools/agent-tool-contracts": loadDomain("packages/ai/src/tools/agent-tool-contracts.ts"),
	"@reactive-resume/resume/proposals": loadDomain("packages/resume/src/proposals.ts"),
	"@reactive-resume/resume/word-diff": {},
	"@reactive-resume/schema/ai-usage": {},
	"@reactive-resume/utils/http": { isNetworkError: () => false },
	"./chat": {},
	"./messages": {},
	"./proposals": {},
	"./recovery": {},
	"./sent": {},
	"./tool-approvals": {},
	"./handoff": {},
	"./markdown": {},
	"./page-fit": {},
	"./save-posting": {},
	"@/features/ai/report-content": {},
	"@/features/ai/web-access": {},
	"@/features/career/fact-categories": { factCategories: () => [] },
	"@/features/documents/queries": {},
	"@/auth/session": { getAccountScope: () => polishScope },
	"@/api/client": {
		orpc: { career: { facts: { key: () => ["facts"] } } },
		client: {
			agent: {
				attachments: {
					create: (input, options) => {
						calls.push({ upload: input, options });
						return pasteUpload;
					},
				},
			},
			career: {
				saveFact: async (input) => {
					calls.push({ fact: input });
					return { id: "fact" };
				},
			},
		},
	},
	"@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: () => {} }) },
	"@/ui": { ...ui, useTheme: () => ({ ...theme, type: { body: { lineHeight: 20 } } }) },
};
const { Composer: PasteComposer } = load(
	"features/assistant/chat-view.tsx",
	polishBoundaries,
	";module.exports.Composer=Composer;",
);
reset();
let recoveredSend;
const recoveredProps = {
	scope: "polish-account",
	initialAttachments: [{ id: "recovered", filename: "Fictional native draft.txt", mediaType: "text/plain", size: 64 }],
	draft: "Review recovered file",
	disabled: false,
	streaming: false,
	ensureThread: async () => "paste-thread",
	onSend: (text, files) => {
		recoveredSend = { text, files };
		return true;
	},
	onStop() {},
};
const recoveredTree = render(PasteComposer, recoveredProps);
assert.ok(JSON.stringify(recoveredTree).includes("Fictional native draft.txt"));
assert.equal(recoveredSend, undefined);
nodes(recoveredTree)
	.find((node) => node.props.accessibilityLabel === "Send")
	.props.onPress();
await settle();
assert.deepEqual(recoveredSend, {
	text: "Review recovered file",
	files: [{ id: "recovered", filename: "Fictional native draft.txt", mediaType: "text/plain" }],
});
assert.equal(JSON.stringify(render(PasteComposer, recoveredProps)).includes("Fictional native draft.txt"), false);
for (const scenario of ["success", "failure", "changed"]) {
	reset();
	let finish;
	let fail;
	pasteUpload = new Promise((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	const original = "Unicode résumé مرحبا 😀\n".repeat(250);
	const props = {
		scope: "polish-account",
		draft: original,
		disabled: false,
		streaming: false,
		ensureThread: async () => "paste-thread",
		onSend: () => assert.fail("Conversion must not send"),
		onStop() {},
	};
	const box = () => nodes(render(PasteComposer, props)).find((n) => n.type === "TextInput").props;
	assert.equal(box().value, original);
	assert.equal(calls.length, 0);
	control(render(PasteComposer, props), "Attach a file instead").onPress();
	await settle();
	assert.equal(calls[0].upload.filename, "message.txt");
	assert.equal(calls[0].options.context.scope, "polish-account");
	assert.equal(Buffer.from(calls[0].upload.data, "base64").toString("utf8"), original);
	assert.equal(box().value, original);
	if (scenario === "changed") box().onChangeText("Fresh native draft");
	if (scenario === "failure") fail(new Error("offline"));
	else finish({ id: "paste-upload", filename: "message.txt", mediaType: "text/plain" });
	await settle();
	assert.equal(
		box().value,
		scenario === "success" ? "Read the attachment" : scenario === "changed" ? "Fresh native draft" : original,
	);
	assert.equal(pasteFiles.size, 0, "Own temporary file must be deleted on success or failure");
}
const {
	Coverage: GapCoverage,
	RememberMessage: RememberAnswer,
	ToolPartView: NativeQuestionPart,
} = load(
	"features/assistant/messages.tsx",
	polishBoundaries,
	";module.exports.Coverage=Coverage;module.exports.RememberMessage=RememberMessage;module.exports.ToolPartView=ToolPartView;",
);
reset();
const nativeQuestion = render(NativeQuestionPart, {
	part: { type: "tool-ask_user_question", state: "output-available", output: "Fictional answer" },
	message: { id: "question", role: "assistant", parts: [] },
	streaming: false,
	readOnly: false,
	answerable: true,
	proposals: [],
	onAnswer() {},
});
for (const node of nodes(nativeQuestion).filter((node) => node.type === "View")) {
	assert.ok(
		node.props.children.flat(Infinity).every((child) => typeof child !== "string" && typeof child !== "number"),
		"Native View children must not contain raw text",
	);
}
reset();
const repeatedRequirements = ["missing", "unassessed"].map((status) => ({
	text: "Repeated requirement",
	status,
	evidence: [],
}));
let repeatedGaps = nodes(render(GapCoverage, { requirements: repeatedRequirements, factText: () => null })).filter(
	(node) => node.props.accessibilityRole === "checkbox",
);
assert.equal(repeatedGaps.length, 2);
repeatedGaps[0].props.onPress();
repeatedGaps = nodes(render(GapCoverage, { requirements: repeatedRequirements, factText: () => null })).filter(
	(node) => node.props.accessibilityRole === "checkbox",
);
assert.deepEqual(
	repeatedGaps.map((node) => node.props.accessibilityState.checked),
	[true, false],
);
reset();
const requirements = [{ text: "Accessibility audits", status: "missing", evidence: [] }];
let gap = nodes(render(GapCoverage, { requirements, factText: () => null })).find(
	(n) => n.props.accessibilityRole === "checkbox",
);
assert.ok(gap);
assert.equal(gap.props.accessibilityState.checked, false);
gap.props.onPress();
gap = nodes(render(GapCoverage, { requirements, factText: () => null })).find(
	(n) => n.props.accessibilityRole === "checkbox",
);
assert.equal(gap.props.accessibilityState.checked, true);
assert.equal(requirements[0].status, "missing");
assert.deepEqual(requirements[0].evidence, []);
assert.equal(calls.length, 0);
reset();
const answerProps = {
	message: { id: "question-message", role: "assistant", parts: [] },
	answer: "I repaired six checkout issues.",
	scope: { applicationId: "fictional-job" },
};
control(render(RememberAnswer, answerProps), "Remember").onPress();
let review = render(RememberAnswer, answerProps);
control(review, "Remember as a fact in Knowledge").onChangeText("I led repairs for six checkout issues.");
control(render(RememberAnswer, answerProps), "Cancel").onPress();
assert.equal(calls.length, 0);
control(render(RememberAnswer, answerProps), "Remember").onPress();
review = render(RememberAnswer, answerProps);
assert.equal(control(review, "Remember as a fact in Knowledge").value, "I led repairs for six checkout issues.");
control(review, "Remember").onPress();
await settle();
assert.deepEqual(calls[0].fact, {
	applicationId: "fictional-job",
	text: "I led repairs for six checkout issues.",
	category: "accomplishment",
	source: { kind: "manual", id: "question-message", quote: "I repaired six checkout issues." },
});
reset();
control(render(RememberAnswer, answerProps), "Remember").onPress();
polishScope = "another-account";
control(render(RememberAnswer, answerProps), "Remember").onPress();
await settle();
assert.equal(calls.length, 0, "Old account answer must not be saved into a new account");
polishScope = "polish-account";
console.log(
	"PASS native recovered attachments send, then clear; long paste uploads exact Unicode text, survives failure or a changed draft and cleans up; question views avoid raw text; gap choices stay isolated; reviewed answers save to Knowledge only for their account",
);

// The actual editor initializes citations once; later renders must not undo an explicit untick.
const citedFact = {
	id: "draft-shared",
	text: "I rebuilt the fictional design system.",
	applicationId: null,
	status: "active",
};
const storyFacts = [
	citedFact,
	{ ...citedFact, id: "draft-excluded", status: "excluded" },
	{ ...citedFact, id: "draft-private", applicationId: "job" },
];
{
	const start = { title: "Draft the project story", note: `Use “${citedFact.text}” as evidence.` };
	reset();
	const draftView = () => render(StoryEditor, { story: null, facts: storyFacts, start, onClose() {} });
	assert.equal(control(draftView(), "Title").value, start.title);
	assert.equal(control(draftView(), citedFact.text).value, true);
	assert.equal(nodes(draftView()).filter((n) => n.type === "SwitchRow").length, 1);
	control(draftView(), citedFact.text).onValueChange(false);
	assert.equal(control(draftView(), citedFact.text).value, false, "rerender preserves the user's explicit choice");
}
console.log("PASS native actual story citation initialization and reviewed deselection");

// Preparation waits for owned facts before mounting an editor whose initialization runs once.
let planFactsQuery = { data: undefined, isPending: true, isError: false, refetch() {} };
const { TestPlan } = load(
	"features/workspace/tabs/prepare.tsx",
	{
		"@/features/ai/providers": { useHasAIProvider: () => ({ defaultProvider: null }) },
		"@tanstack/react-query": {},
		"@/api/flags": {},
		"@reactive-resume/utils/locale": { formatList: (items) => items.join(", ") },
		"@reactive-resume/schema/career-schedule": loadDomain("packages/schema/src/career-schedule.ts"),
		"../hooks": {
			useFacts: () => planFactsQuery,
			useTicks: () => ({ ticked: [] }),
			useWorkspace: () => ({ data: { questions: [] } }),
			useGenerate: () => ({ isPending: false }),
		},
		"../logic": {},
		"../parts": {
			useWorking: () => "Plan again",
			workingSteps: () => [],
			Actions: "Actions",
			AiNotice: "AiNotice",
			Block: "Block",
			CheckRow: "CheckRow",
			Pill: "Pill",
			GenerateNotice: "GenerateNotice",
		},
		"../shell": { WorkspaceScreen: "WorkspaceScreen" },
		"@/features/career/shared": { LoadState: "LoadState" },
		"@/features/career/stories": { StoryEditor: "StoryEditor" },
		"@/features/application-detail/hooks": {},
	},
	";module.exports.TestPlan = Plan;",
);
reset();
const planStep = {
	minutes: 10,
	title: "Draft the project story",
	detail: "Explain the project.",
	action: "draft-story",
	storyId: null,
	factIds: [citedFact.id],
};
const planView = () =>
	render(TestPlan, {
		application: { id: "story-job" },
		briefing: {
			id: "story-plan",
			data: {
				plan: [planStep],
				questions: [],
				stories: [],
				storyIds: [],
				headline: "Plan",
				summary: "",
				focus: "",
				opening: "",
				honesty: "",
			},
		},
		readOnly: true,
		go() {},
	});
const stepAction = nodes(planView()).find((n) => n.type === "Button" && n.props.label === "Draft story");
assert.ok(stepAction, "actual plan exposes the Draft story action");
stepAction.props.onPress();
assert.equal(
	nodes(planView()).some((n) => n.type === "StoryEditor"),
	false,
);
assert.equal(nodes(planView()).find((n) => n.type === "LoadState").props.query, planFactsQuery);
planFactsQuery = { ...planFactsQuery, isPending: false, isError: true };
assert.equal(
	nodes(planView()).some((n) => n.type === "StoryEditor"),
	false,
);
planFactsQuery = { ...planFactsQuery, isError: false, data: storyFacts };
const readyStory = nodes(planView()).find((n) => n.type === "StoryEditor");
assert.equal(readyStory.props.facts, storyFacts);
assert.deepEqual(readyStory.props.start.factIds, [citedFact.id]);
console.log("PASS native actual plan keeps citation initialization behind fact loading and failure");
