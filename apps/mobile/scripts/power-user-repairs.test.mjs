import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
// Actual native screen and load-state owners; widgets and transport remain explicit host boundaries.
import { i18n } from "@lingui/core";
import { esbuild, run, tag } from "./harness.mjs";
i18n.loadAndActivate({ locale: "en-US", messages: {} });
let hooks = [];
let cursor = 0;
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const react = {
	createElement: element,
	useState(initial) {
		const i = cursor++;
		if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
		return [
			hooks[i],
			(value) => {
				hooks[i] = typeof value === "function" ? value(hooks[i]) : value;
			},
		];
	},
	useEffect(effect, deps) {
		const i = cursor++;
		const previous = hooks[i];
		if (!previous || !deps || deps.some((value, index) => value !== previous.deps?.[index])) {
			previous?.cleanup?.();
			hooks[i] = { deps, cleanup: effect() };
		}
	},
};
function reset() {
	for (const hook of hooks) hook?.cleanup?.();
	hooks = [];
}
const theme = {
	space: { s1: 4, s2: 8, s3: 12, s4: 16, s12: 48 },
	size: { panel: 400, input: 44, icon: { row: 20 } },
	radius: { rLg: 8 },
	colors: { bg: "white", sunken: "gray", ink: "black", ink3: "gray" },
	type: { bodyLarge: {} },
};
const ui = Object.fromEntries(
	[
		"Banner",
		"Button",
		"Card",
		"EmptyState",
		"Icon",
		"IconButton",
		"ListRow",
		"Screen",
		"SelectSheet",
		"Skeleton",
		"Switch",
		"Text",
	].map((name) => [name, name]),
);
const calls = [];
ui.useTheme = () => theme;
ui.showToast = (value) => calls.push(value);
const router = { dismissTo: (href) => calls.push(href), push: (href) => calls.push(href), back() {} };
const routes = {
	documents: () => "/documents",
	builder: (id) => `/builder/${id}`,
	letter: (id) => `/letter/${id}`,
	application: (id) => `/applications/${id}`,
	assistant: (id) => `/builder/${id}/assistant`,
	letterAssistant: (id) => `/letter/${id}/assistant`,
	new: () => "/new",
	newJob: () => "/applications?create=1",
	career: (p) => `/career/${p}`,
	settings: (p) => `/settings/${p ?? ""}`,
	atsChecker: () => "/ats-checker",
	trash: () => "/documents/trash",
};
const common = {
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
	"react-native": {
		View: "View",
		Pressable: "Pressable",
		ScrollView: "ScrollView",
		TextInput: "TextInput",
		Platform: { OS: "android" },
		BackHandler: { addEventListener: () => ({ remove() {} }) },
	},
	"expo-router": {
		useRouter: () => router,
		useLocalSearchParams: () => ({}),
		useIsFocused: () => true,
		Stack: { Screen: "StackScreen" },
	},
	"@lingui/core": { i18n },
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n }) },
	"@lingui/core/macro": {
		t: tag,
		ph: (values) => Object.values(values)[0],
		plural: (value, forms) => forms.other.replace("#", String(value)),
	},
	"@/ui": ui,
	"@/routes": { routes },
};
function load(file, mocks = {}, globals = {}) {
	const source = readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
	const { code } = esbuild.transformSync(source, {
		loader: file.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	});
	return run(code, { ...common, ...mocks }, { React: react, ...globals });
}
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props?.children)];
function render(component) {
	cursor = 0;
	return component();
}
function expand(tree) {
	if (!tree || typeof tree !== "object") return tree;
	if (Array.isArray(tree)) return tree.map(expand);
	if (typeof tree.type === "function") return expand(tree.type(tree.props));
	return { ...tree, props: { ...tree.props, children: expand(tree.props.children) } };
}
const state = (over = {}) => ({
	data: [],
	isPending: false,
	isError: false,
	refetch: () => calls.push("retry"),
	...over,
});
let applications = state();
const saved = state();
const profile = state({ data: {} });
const zod = createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod");
const timeParser = load("../../../packages/utils/src/timezone.ts", { zod });
const applicationData = load("../../../packages/schema/src/applications/data.ts", {
	zod,
	"@reactive-resume/utils/timezone": timeParser,
});
const careerSchema = load("../../../packages/schema/src/career.ts", {
	zod,
	"./ai-usage": load("../../../packages/schema/src/ai-usage.ts", { zod }),
	"./applications/data": applicationData,
	"@reactive-resume/utils/region": { searchRegionsSchema: zod.z.array(zod.z.string()).nullable().optional() },
	"@reactive-resume/utils/timezone": timeParser,
});
const offerDomain = load("../../../packages/schema/src/career-offer.ts", {
	"./career": careerSchema,
	"@reactive-resume/utils/amount": load("../../../packages/utils/src/amount.ts"),
	"@reactive-resume/utils/timezone": timeParser,
});
const shared = load("features/career/shared.tsx");
let selectionScope = "offer-account";
let offersFocused = true;
const selection = load("features/career/offer-selection.ts", {
	"@/auth/session": { getAccountScope: () => selectionScope },
	"zustand/react": {
		create: (initialize) => {
			const store = createRequire(new URL("../../web/package.json", import.meta.url))("zustand/vanilla").createStore(
				initialize,
			);
			return Object.assign((selector) => selector(store.getState()), store);
		},
	},
});
const { OffersScreen } = load("features/career/offers.tsx", {
	"@/auth/session": { getAccountScope: () => selectionScope },
	"./offer-selection": selection,
	"expo-router": {
		...common["expo-router"],
		useIsFocused: () => offersFocused,
		useRouter: () => ({ ...router, setParams: (params) => calls.push({ offerParams: params }) }),
	},
	"@reactive-resume/utils/timezone": timeParser,
	"./hooks": {
		useOffers: () => saved,
		useCareerQueries: () => ({ profile }),
		useCareerTime: () => ({ locale: "en-US", timeZone: "UTC", when: String }),
		useNow: () => new Date(),
		useUndoRows: () => ({
			hidden: [],
			remove() {
				throw new Error("Unexpected delete in loading test");
			},
		}),
	},
	"@reactive-resume/schema/career-offer": offerDomain,
	"./offer-compare": load("features/career/offer-compare.ts", { "@reactive-resume/schema/career-offer": offerDomain }),
	"./offer-entry": { OfferEntry: "OfferEntry", OfferForm: "OfferForm" },
	"./undo": {
		withUndo: () => {
			throw new Error("Unexpected delete in loading test");
		},
	},
	"./shared": shared,
	"@/features/applications/queries": { useApplications: () => applications },
});
for (const mode of ["pending", "error"]) {
	hooks = [];
	applications = state({ data: undefined, isPending: mode === "pending", isError: mode === "error" });
	const raw = render(OffersScreen);
	assert.equal(
		nodes(raw).some((n) => n.type === "EmptyState" || n.type === "OfferEntry"),
		false,
		"unavailable metadata cannot show empty or entry form",
	);
	const tree = expand(raw);
	if (mode === "error") {
		assert.ok(nodes(tree).some((n) => n.type === "Banner"));
		nodes(tree)
			.find((n) => n.type === "Button" && n.props.label === "Retry")
			.props.onPress();
		assert.equal(calls.at(-1), "retry");
	}
}
hooks = [];
applications = state({ data: [{ id: "persisted", company: "Fictional Offer", role: "Engineer", status: "offer" }] });
let tree = expand(render(OffersScreen));
assert.ok(
	nodes(tree).some(
		(n) => n.type === "Text" && nodes(n).some((child) => child.props.children.includes("Fictional Offer")),
	),
);
assert.equal(
	nodes(tree).find((n) => n.type === "OfferEntry" && n.props.application)?.props.application.id,
	"persisted",
);
hooks = [];
applications = state();
tree = expand(render(OffersScreen));
assert.ok(nodes(tree).some((n) => n.type === "EmptyState" && n.props.title === "No offers to compare yet"));
applications = state({
	data: [{ id: "persisted", company: "Fictional Offer", role: "Engineer", status: "offer" }],
	isError: true,
});
tree = expand(render(OffersScreen));
assert.ok(
	nodes(tree).some((n) => n.type === "Banner"),
	"background failure stays visible",
);
assert.equal(
	nodes(tree).find((n) => n.type === "OfferEntry" && n.props.application)?.props.application.id,
	"persisted",
	"cached metadata keeps the user's form mounted during a background error",
);

const retainedTerms = {
	kind: "offer",
	version: "written",
	currency: "EUR",
	period: "year",
	base: 100000,
	variable: null,
	variableConditions: "",
	equity: "",
	location: "",
	officeDays: null,
	leave: "",
	learning: null,
	other: "",
	respondBy: null,
};
saved.data = [
	{
		id: "retained",
		applicationId: "saved-job",
		application: { company: "Retained Co", role: "Engineer", status: "offer" },
		data: retainedTerms,
		createdAt: new Date(),
	},
];
profile.data = {
	minBase: { amount: null, currency: "EUR", period: "year" },
	locations: [],
	maxOfficeDays: null,
	noticeWeeks: null,
};
for (const mode of ["pending", "error"]) {
	reset();
	applications = state({ data: undefined, isPending: mode === "pending", isError: mode === "error" });
	const retained = expand(render(OffersScreen));
	assert.ok(
		nodes(retained).some((node) => node.type === "Text" && node.props.children.includes("Retained Co")),
		"saved offer survives missing application metadata",
	);
	assert.ok(
		nodes(retained).some(
			(node) =>
				node.type === "Text" &&
				node.props.children.some((child) => typeof child === "string" && child.includes("€100,000")),
		),
		"comparison terms remain available",
	);
	if (mode === "error") assert.ok(nodes(retained).some((node) => node.type === "Banner"));
}
selection.rememberSavedOffer(selectionScope, "retained", "pinned");
saved.data.push({ ...saved.data[0], id: "pinned" });
offersFocused = false;
calls.length = 0;
reset();
render(OffersScreen);
assert.ok(!calls.some((call) => call?.offerParams), "blurred Offers cannot mutate the current route");
assert.equal(selection.useSavedOffer.getState().accounts[selectionScope].id, "retained");
selectionScope = "another-account";
offersFocused = true;
reset();
render(OffersScreen);
assert.ok(!calls.some((call) => call?.offerParams), "another account cannot consume a saved selection");
selectionScope = "offer-account";
reset();
render(OffersScreen);
assert.deepEqual(calls.find((call) => call?.offerParams)?.offerParams, {
	a: "retained",
	b: "pinned",
	highlight: "retained",
});
assert.equal(selection.useSavedOffer.getState().accounts[selectionScope], undefined);
for (const [otherTerms, note] of [
	[{ ...retainedTerms, variablePercent: 5 }, "€5,000 more"],
	[{ ...retainedTerms, variable: 15000 }, "€5,000 less"],
	[{ ...retainedTerms, currency: "USD", variablePercent: 5 }, null],
	[{ ...retainedTerms, period: "month", variablePercent: 5 }, null],
	[{ ...retainedTerms, base: null, variablePercent: 5 }, null],
]) {
	reset();
	saved.data = [
		{ ...saved.data[0], id: "percentage", data: { ...retainedTerms, variablePercent: 10 } },
		{ ...saved.data[0], id: "comparison", applicationId: "other-job", data: otherTerms },
	];
	const compared = expand(render(OffersScreen));
	const values = nodes(compared)
		.filter((node) => node.type === "Text")
		.flatMap((node) => node.props.children);
	const bonus = values.find((value) => typeof value === "string" && value.startsWith("10% of base"));
	assert.ok(bonus?.includes("€10,000"), "percentage stays visible alongside its amount");
	if (note) assert.ok(bonus.includes(note), "native percentage bonus retains its money-difference note");
	else assert.ok(!/more|less/.test(bonus), "incomparable or unknown bonus has no difference note");
}
reset();
saved.data[0].data = { ...retainedTerms, base: null, variablePercent: 10 };
const unknownBase = nodes(expand(render(OffersScreen)))
	.filter((node) => node.type === "Text")
	.flatMap((node) => node.props.children);
assert.ok(
	unknownBase.some((value) => value === "10% of base"),
	"unknown base preserves the entered bonus rate",
);
saved.data = [];

console.log("PASS native Offers loading/error/retry/persisted row and genuine-empty controls");

let count = 9;
let failed = false;
let resumesPending = false;
let resumeCount = 0;
const searchAi = { isUnavailable: false, hasAIProvider: true, isLoading: false };
let searchScope = "fixture-account";
let latestSearchDocument = [];
const inputs = [];
const letters = Array.from({ length: 209 }, (_, i) => ({
	id: `letter-${i + 1}`,
	type: "letter",
	name: `Fictional letter ${i + 1}`,
	tags: ["rx112overflow"],
	updatedAt: new Date(),
	application: null,
}));
// The search debounce runs on this clock, so tests advance time instead of waiting for it.
let clockNow = 0;
let clockTimers = [];
const clock = {
	setTimeout: (run, delay = 0) => {
		const timer = { run, at: clockNow + delay };
		clockTimers.push(timer);
		return timer;
	},
	clearTimeout: (timer) => {
		clockTimers = clockTimers.filter((item) => item !== timer);
	},
};
const advance = (ms) => {
	clockNow += ms;
	const due = clockTimers.filter((timer) => timer.at <= clockNow);
	clockTimers = clockTimers.filter((timer) => timer.at > clockNow);
	for (const timer of due) timer.run();
};
const { SearchScreen } = load(
	"features/search/search-screen.tsx",
	{
		"./rank": load("features/search/rank.ts"),
		"@/features/ai/providers": { useHasAIProvider: () => searchAi, AIProviderSetupSheet: "AIProviderSetupSheet" },
		"@/auth/session": {
			getAccountScope: () => searchScope,
			useSession: () => ({ status: "signed-in", server: "fixture-server" }),
		},
		"@/shell/use-is-tablet": { useIsTablet: () => false },
		"@/features/applications/queries": { useApplications: () => state() },
		"@/api/client": {
			orpc: {
				documents: { list: { queryOptions: ({ input }) => ({ queryKey: ["documents", input] }) } },
				agent: { threads: { list: { queryOptions: () => ({ queryKey: ["threads"] }) } } },
			},
			client: {
				documents: {
					list: async (input) => {
						inputs.push(input);
						return [{ id: "recent" }];
					},
				},
			},
		},
		"@tanstack/react-query": {
			useQuery: ({ queryKey, enabled }) => {
				if (queryKey[0] === "threads") return state();
				const input = queryKey[1];
				inputs.push(input);
				if (input.type === "resume")
					return state({
						isPending: resumesPending,
						data: Array.from({ length: resumeCount }, (_, i) => ({
							id: `resume-${i}`,
							type: "resume",
							name: `Archive resume ${i}`,
							tags: [],
						})),
					});
				if (!enabled) return state({ data: undefined, isPending: true });
				return input.type === "letter"
					? state({ data: failed ? undefined : letters.slice(0, Math.min(input.limit, count)), isError: failed })
					: state({ data: latestSearchDocument });
			},
		},
	},
	clock,
);
for (count of [8, 9, 209]) {
	reset();
	tree = render(SearchScreen);
	nodes(tree)
		.find((n) => n.type === "TextInput")
		.props.onChangeText("rx112overflow");
	render(SearchScreen);
	advance(200);
	tree = render(SearchScreen);
	const rows = nodes(tree).filter((n) => n.type === "ListRow");
	assert.equal(rows.filter((n) => n.props.title.startsWith("Fictional letter")).length, 8);
	const more = rows.find((n) => n.props.title === "Show all letters");
	assert.equal(!!more, count > 8);
	if (more) {
		more.props.onPress();
		assert.deepEqual(calls.at(-1), { pathname: "/documents", params: { q: "rx112overflow", type: "letter" } });
	}
}
assert.ok(
	inputs.some(
		(input) => input.q === "rx112overflow" && input.type === "letter" && input.limit === 9 && input.offset === 0,
	),
);
failed = true;
tree = render(SearchScreen);
assert.ok(nodes(tree).some((n) => n.type === "Banner"));
nodes(tree)
	.find((n) => n.type === "Button" && n.props.label === "Retry")
	.props.onPress();
assert.equal(calls.at(-1), "retry");
console.log("PASS native 8/9/multipage letter preview, server query, preserved continuation and transport retry");

reset();

// Enter cannot run a local action or Ask before the current document lookup settles.
failed = false;
reset();
tree = render(SearchScreen);
nodes(tree)
	.find((node) => node.type === "TextInput")
	.props.onChangeText("resume");
render(SearchScreen);
advance(200);
resumesPending = true;
tree = render(SearchScreen);
const beforePendingEnter = calls.length;
nodes(tree)
	.find((node) => node.type === "TextInput")
	.props.onSubmitEditing();
assert.equal(calls.length, beforePendingEnter, "pending Enter cannot open a local shortcut or assistant");
resumesPending = false;
resumeCount = 100;
tree = render(SearchScreen);
const moreResumes = nodes(tree).find((node) => node.type === "ListRow" && node.props.title === "Show all");
assert.ok(moreResumes);
moreResumes.props.onPress();
tree = render(SearchScreen);
const libraryContinuation = nodes(tree).find((node) => node.type === "ListRow" && node.props.title === "Show all");
assert.ok(libraryContinuation);
libraryContinuation.props.onPress();
assert.deepEqual(calls.at(-1), { pathname: "/documents", params: { q: "resume", type: "resume" } });
console.log("PASS native pending Enter and 100-resume filtered library continuation");
reset();

searchAi.hasAIProvider = false;
tree = render(SearchScreen);
nodes(tree)
	.find((node) => node.type === "TextInput")
	.props.onChangeText("Keep my fictional question");
tree = render(SearchScreen);
const beforeSetup = calls.length;
nodes(tree)
	.find((node) => node.type === "ListRow" && node.props.title.startsWith("Connect an AI provider to ask"))
	.props.onPress();
tree = render(SearchScreen);
assert.equal(calls.length, beforeSetup, "provider setup must not dismiss Search to Settings");
assert.equal(nodes(tree).find((node) => node.type === "AIProviderSetupSheet").props.open, true);
nodes(tree)
	.find((node) => node.type === "AIProviderSetupSheet")
	.props.onClose();
tree = render(SearchScreen);
assert.equal(nodes(tree).find((node) => node.type === "TextInput").props.value, "Keep my fictional question");
assert.equal(nodes(tree).find((node) => node.type === "AIProviderSetupSheet").props.open, false);
searchAi.hasAIProvider = true;
for (const type of ["resume", "letter"]) {
	latestSearchDocument = [{ id: `named-${type}`, type, name: `Fictional named ${type}` }];
	tree = render(SearchScreen);
	const ask = nodes(tree).find((node) => node.type === "ListRow" && node.props.title.startsWith("Ask about"));
	assert.ok(ask.props.title.includes(`Fictional named ${type}`));
	ask.props.onPress();
	assert.deepEqual(
		calls.at(-1),
		{
			pathname: type === "resume" ? `/builder/named-${type}/assistant` : `/letter/named-${type}/assistant`,
			params: { draft: "Keep my fictional question" },
		},
		"the named document receives an unsent draft, never the auto-send ask parameter",
	);
}
const queuedNamedAsk = nodes(tree).find((node) => node.type === "ListRow" && node.props.title.startsWith("Ask about"));
const beforeQueuedNamedAsk = calls.length;
searchScope = "replacement-account";
queuedNamedAsk.props.onPress();
assert.equal(calls.length, beforeQueuedNamedAsk, "queued named Ask cannot navigate under a replacement account");
searchScope = "fixture-account";
searchAi.hasAIProvider = false;
tree = render(SearchScreen);
nodes(tree)
	.find((node) => node.type === "ListRow" && node.props.title.startsWith("Connect an AI provider to ask"))
	.props.onPress();
searchScope = "replacement-account";
render(SearchScreen);
tree = render(SearchScreen);
assert.equal(nodes(tree).find((node) => node.type === "TextInput").props.value, "");
assert.equal(nodes(tree).find((node) => node.type === "AIProviderSetupSheet").props.open, false);
searchScope = "fixture-account";
searchAi.hasAIProvider = true;
reset();
console.log("PASS native palette setup retains question, binds named document and hands over unsent draft");

const { AssistantScreen, LetterAssistantScreen } = load("features/assistant/assistant-screen.tsx", {
	"./chat": { useThreads: () => ({ data: [], refetch() {} }) },
	"./chat-view": { ChatView: "ChatView", ContextChip: "ContextChip" },
	"./chat-welcome": { ChatWelcome: "ChatWelcome" },
	"./document": {
		useResumeAssistantDocument: () => ({ kind: "resume", id: "named-resume", name: "Fictional resume", locked: false }),
		useLetterAssistantDocument: () => ({ kind: "letter", id: "named-letter", name: "Fictional letter", locked: false }),
	},
	"./handoff": { takeAssistantHandoff: () => null },
	"./proposals": { publishProposals() {} },
	"./provider": {
		ConnectionNotice: "ConnectionNotice",
		ModelButton: "ModelButton",
		ModelSheet: "ModelSheet",
		ProviderGate: "ProviderGate",
		useConversationProvider: () => ({ provider: { id: "fictional" }, label: "Fictional provider", choose() {} }),
	},
	"./threads": { PastConversations: "PastConversations" },
	"./translate-resume": { TranslateResume: "TranslateResume" },
	"react-native-safe-area-context": { SafeAreaProvider: "SafeAreaProvider", SafeAreaView: "SafeAreaView" },
	"@/api/client": {
		client: { agent: { threads: { start: () => assert.fail("Opening a draft must not start a thread") } } },
	},
	"@/auth/session": { getAccountScope: () => "fixture-account", useSession: () => ({ status: "signed-in" }) },
	"@/draft": {
		useResumeStore: (select) => select({ document: {}, status: "saved" }),
		useLetterStore: (select) => select({ document: {}, status: "saved" }),
	},
	"@/features/ai/providers": { useHasAIProvider: () => ({ usableProviders: [{ id: "fictional" }] }) },
	"@/features/write/unlock": { useUnlockResume: () => ({}) },
});
for (const [component, id] of [
	[AssistantScreen, { resumeId: "named-resume" }],
	[LetterAssistantScreen, { letterId: "named-letter" }],
]) {
	for (const mode of ["draft", "ask"]) {
		reset();
		const outer = render(() => component({ ...id, [mode]: "Fictional task" }));
		tree = render(() => outer.type(outer.props));
		const chat = nodes(tree).find((node) => node.type === "ChatView");
		assert.equal(chat.props.threadId, null);
		assert.equal(chat.props.draft, mode === "draft" ? "Fictional task" : undefined);
		assert.equal(chat.props.prompt, mode === "ask" ? "Fictional task" : null);
		nodes(tree)
			.find((node) => node.type === "IconButton" && node.props.label === "New conversation")
			.props.onPress();
		tree = render(() => outer.type(outer.props));
		assert.equal(
			nodes(tree).find((node) => node.type === "ChatView").props.draft,
			undefined,
			"a new conversation must not replay initial draft",
		);
	}
}
reset();
console.log("PASS native resume and letter draft links fill composer without auto-send; legacy ask links unchanged");
for (const [path, exportName, screen] of [
	["builder/[id]/assistant.tsx", "default", AssistantScreen],
	["letter/[id]/assistant.tsx", "default", LetterAssistantScreen],
]) {
	const route = load("../app/" + path, {
		"expo-router": {
			...common["expo-router"],
			useLocalSearchParams: () => ({ id: "named", draft: "Unsent route task" }),
		},
		"@/features/assistant/assistant-screen": { AssistantScreen, LetterAssistantScreen },
	})[exportName];
	const target = nodes(route()).find((node) => node.type === screen);
	assert.equal(target.props.draft, "Unsent route task");
	assert.equal(target.props.ask, undefined);
}
console.log("PASS native resume and letter routes preserve draft parameter without converting it to auto-send");
