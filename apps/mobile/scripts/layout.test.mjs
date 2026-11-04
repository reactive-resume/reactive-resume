// Run: node apps/mobile/scripts/layout.test.mjs
// Execute shipped layout components; native measurements and navigation are boundary fixtures.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { i18n } from "@lingui/core";
import { groupDocumentsByApplication, groupIsExpanded } from "@reactive-resume/schema/applications/document-groups";
import { load as loadSource, mobileRequire, tag } from "./harness.mjs";

i18n.loadAndActivate({ locale: "en-US", messages: {} });

const window = { width: 951, height: 669, fontScale: 1 };
const insets = { top: 0, bottom: 20, left: 0, right: 84 };
const calls = [];
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const native = {
	View: "View",
	Text: "NativeText",
	ScrollView: "ScrollView",
	TextInput: "TextInput",
	Keyboard: { dismiss() {} },
	Pressable: "Pressable",
	I18nManager: { isRTL: false },
	Platform: { OS: "ios", select: (values) => values.ios ?? values.default },
	Easing: { bezier: () => null },
	useWindowDimensions: () => window,
};
const safe = { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => insets };
const react = { createElement: element, createContext: (current) => ({ current }), use: (context) => context.current };
const router = {
	push: (href) => calls.push(href),
	navigate: (href) => calls.push(href),
};
const routes = {
	documents: () => "/documents",
	trash: () => "/documents/trash",
	new: () => "/new",
	search: () => "/search",
	settings: (page) => `/settings/${page}`,
};
const mocks = {
	"@lingui/core": { i18n },
	"@/shell/shortcut-help": {
		ShortcutHelpButton: "ShortcutHelpButton",
		CharacterShortcutSetting: "CharacterShortcutSetting",
		useShortcutHelp: { getState: () => ({ show() {} }) },
	},
	"./shortcut-help": { ShortcutHelpButton: "ShortcutHelpButton" },
	react,
	"@/shell/key-commands": { useKeyCommands() {} },
	"react-native": native,
	"react-native-safe-area-context": safe,
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n }) },
	"expo-router": {
		useLocalSearchParams: () => ({}),
		useRouter: () => router,
		usePathname: () => "/documents",
	},
	"expo-observe": { useObserve: () => ({ markInteractive() {} }) },
	"react-native-keyboard-controller": { KeyboardAwareScrollView: "ScrollView", useKeyboardState: () => false },
	"react-native-reanimated": { useAnimatedReaction: (prepare, react) => effects.push(() => react(prepare(), null)) },
	"react-native-worklets": { scheduleOnRN: (run, ...args) => run(...args) },
	"./use-new-action": { useNewAction: () => () => router.push(routes.new()) },
	"./workspace-tab-label": { workspaceTabLabel: (tab) => tab },
	"@/routes": { routes },
};
let keyboardHeight = 0;
mocks["react-native-keyboard-controller"].useKeyboardState = (select) =>
	select({ height: keyboardHeight, isVisible: keyboardHeight > 0 });
mocks["react-native-keyboard-controller"].useReanimatedKeyboardAnimation = () => ({
	height: { get: () => keyboardHeight },
});
const load = (path, extra = {}, globals = {}) =>
	loadSource(`../src/${path}`, { ...mocks, ...extra }, { jsx: "transform", globals: { React: react, ...globals } });
const tokens = load("ui/tokens.ts");
const theme = { ...tokens, colors: tokens.colors.light, shadows: tokens.shadows.light };
const ui = {
	Text: "Text",
	Button: "Button",
	IconButton: "IconButton",
	Icon: "Icon",
	haptics: { selection() {} },
	useTheme: () => theme,
};
mocks["@/ui"] = ui;
mocks["./theme"] = ui;
// Gesture state has its own timing regression; layout fixtures do not pull.
const pullRefresh = { usePullRefresh: () => ({ refreshing: false, onRefresh() {} }) };
mocks["./use-pull-refresh"] = pullRefresh;
mocks["@/ui/use-pull-refresh"] = pullRefresh;
mocks["@/components/collection-header"] = { CollectionHeader: "CollectionHeader" };
const { useIsTablet: isTablet } = load("shell/use-is-tablet.ts");
mocks["./use-is-tablet"] = { useIsTablet: isTablet };
const keyboardLayout = load("ui/keyboard.tsx");
mocks["./keyboard"] = keyboardLayout;
mocks["@/ui/keyboard"] = keyboardLayout;
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props.children)];
ui.useReducedMotion = () => false;
mocks["@/shell/use-is-tablet"] = { useIsTablet: isTablet };
mocks["expo-router"].Stack = { Screen: "Stack.Screen" };
const hooks = [];
let cursor = 0;
let effects = [];
react.useState = (initial) => {
	const index = cursor++;
	if (!(index in hooks)) hooks[index] = initial;
	return [
		hooks[index],
		(value) => {
			hooks[index] = value;
		},
	];
};
react.useEffect = (effect, deps) => {
	const index = cursor++;
	const previous = hooks[index];
	if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
		previous?.cleanup?.();
		effects.push(() => {
			hooks[index] = { deps, cleanup: effect() };
		});
	}
};
const render = (component, props = {}) => {
	cursor = 0;
	effects = [];
	const tree = component(props);
	for (const effect of effects) effect();
	return tree;
};
// Android activity recreation can leave event caches visible after the native keyboard has closed.
react.Children = { count: (children) => (children == null ? 0 : Array.isArray(children) ? children.length : 1) };
const { Bar: VisibilityBar } = load("shell/app-tabs.tsx", {
	"react-native-reanimated": {},
	"react-native-keyboard-controller": { useKeyboardState: () => true },
});
hooks.length = 0;
assert.ok(render(VisibilityBar), "Native keyboard is hidden: stale event cache must not hide navigation");
for (const height of [300, 450, 0, 300, 0]) {
	keyboardHeight = height;
	render(VisibilityBar);
	assert.equal(render(VisibilityBar) === null, height !== 0, "Navigation follows native frames after recreation");
}
hooks.length = 0;
react.useRef = (initial) => react.useState({ current: initial })[0];
react.useCallback = (callback) => callback;
// The first focus must allow Improve for an existing line without requiring another caret tap.
const richText = load("features/write/rich-text.ts");
const { RichTextField, RichTextToolbar } = load("features/write/rich-text-field.tsx", {
	react: {
		...react,
		useState: (initial) => react.useState(typeof initial === "function" ? initial() : initial),
		useEffect() {},
		useLayoutEffect(effect) {
			effect();
		},
		useMemo: (compute) => compute(),
		useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
	},
	"@lingui/core/macro": { ph: (named) => Object.values(named)[0], plural: () => "characters" },
	"react-native-enriched-html": { EnrichedTextInput: "RichInput" },
	"./rich-text": richText,
	"./improve": { ImprovePanel: "ImprovePanel" },
	"./pickers": { PromptSheet: "PromptSheet" },
	"@/auth/session": { getAccountScope: () => "layout-account" },
	"@/draft": { resumeFieldFocus: { onFocus() {}, onBlur() {} }, letterFieldFocus: { onFocus() {}, onBlur() {} } },
});
for (const text of ["Existing line", ""]) {
	hooks.length = 0;
	const field = render(RichTextField, { label: "Summary", value: `<p>${text}</p>`, onChange() {} });
	const input = nodes(field).find((node) => node.type === "RichInput");
	input.props.onChangeText({ nativeEvent: { value: text } });
	input.props.onFocus();
	const toolbar = render(RichTextToolbar);
	const improve = nodes(toolbar).find((node) => node.props.label === "Improve selected line");
	assert.equal(improve.props.disabled, text === "", "First focus enables Improve only for nonempty lines");
	input.props.onBlur();
}
console.log("PASS native navigation survives stale keyboard events and first focus enables Improve on nonempty lines");

hooks.length = 0;
native.StyleSheet = { hairlineWidth: 1 };
const animation = {
	View: "Animated.View",
	useSharedValue: (initial) => ({ get: () => initial, set() {} }),
	useAnimatedStyle: () => ({}),
	withTiming: (value) => value,
	withSpring: (value) => value,
	withSequence: (...values) => values.at(-1),
};
native.FlatList = "FlatList";
let documentQuery = {
	data: { items: [], total: 19500, counts: { resume: 19500, letter: 0 }, tags: [], hasPublic: false },
	isError: false,
	isPlaceholderData: false,
	refetch() {},
};
let documentInput;
let documentPlaceholder;
let pendingDocuments = [];
const documentPage = (input) => ({ queryKey: ["document-page", input] });
let libraryParams = {};
let libraryAccountScope = "fixture";
const restoredFromSheet = [];
const librarySession = load("features/documents/library-session.ts", {
	"zustand/react": {
		create: (initialize) => {
			const store = mobileRequire("zustand/vanilla").createStore(initialize);
			return Object.assign((select) => select(store.getState()), store);
		},
	},
	"@/auth/session": { getAccountScope: () => libraryAccountScope },
});
// The library debounce runs on this clock, so tests advance time instead of waiting for it.
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
const { DocumentsLibrary } = load(
	"features/documents/library.tsx",
	{
		"@reactive-resume/schema/applications/document-groups": { groupDocumentsByApplication, groupIsExpanded },
		"./library-session": librarySession,
		"@legendapp/list/reanimated": { AnimatedLegendList: "FlatList" },
		"./document-sheets": { DocumentSheets: "DocumentSheets" },
		"./removal-motion": {
			DocumentMotionFrame: "Animated.View",
			useDocumentRemovalMotion: () => ({ register: () => () => {}, onEffect: async () => {} }),
		},
		"./filter": load("features/documents/filter.ts"),
		"./new-documents": {},
		"./pending": { usePendingDocuments: () => pendingDocuments },
		"./queries": {
			useDocumentOperations: () => ({
				busy: false,
				restoreSelected: async (documents) => {
					restoredFromSheet.push(documents);
					return true;
				},
			}),
		},
		"./thumbnail": { Thumbnail: "Thumbnail" },
		"@/api/client": {
			client: {},
			orpc: {
				documents: {
					page: { queryOptions: ({ input }) => documentPage(input) },
					counts: { queryOptions: () => ({ queryKey: ["counts"] }) },
				},
			},
		},
		"@/auth/session": {
			useSession: () => ({ status: "signed-in", server: "fixture" }),
			getAccountScope: () => libraryAccountScope,
		},
		"@/components/collection-header": { CollectionHeader: "CollectionHeader" },
		"@tanstack/react-query": {
			useQuery: ({ queryKey, placeholderData }) => {
				if (queryKey[0] !== "document-page") return { data: { trash: 0 }, refetch() {} };
				documentInput = queryKey[1];
				documentPlaceholder = placeholderData;
				return documentQuery;
			},
		},
		"expo-haptics": {},
		"expo-router": {
			...mocks["expo-router"],
			useFocusEffect() {},
			useLocalSearchParams: () => libraryParams,
			useRouter: () => ({
				...mocks["expo-router"].useRouter(),
				setParams: (next) => {
					libraryParams = { ...libraryParams, ...next };
				},
			}),
		},
		"@lingui/core/macro": {
			ph: (named) => Object.values(named)[0],
			plural: (count, options) => options[count === 1 ? "one" : "other"].replace("#", count),
		},
		"react-native-gesture-handler/ReanimatedSwipeable": {},
		"react-native-reanimated": { ...animation, FlatList: "FlatList" },
		"@/ui": {
			...ui,
			Screen: "Screen",
			ListRow: "ListRow",
			Chip: "Chip",
			Banner: "Banner",
			listItemMotion: () => ({}),
			listLayout: {},
			useFirstAppearance: () => false,
			useReducedMotion: () => false,
		},
	},
	clock,
);
// A search continuation updates the already-mounted tab, clears its one-shot params, and preserves library paging ownership.
hooks.length = 0;
render(DocumentsLibrary);
libraryParams = { q: "rx112overflow", type: "letter" };
render(DocumentsLibrary);
render(DocumentsLibrary);
assert.equal(documentInput.q, "rx112overflow");
assert.equal(documentInput.type, "letter");
assert.equal(documentInput.offset, 0);
assert.equal(documentInput.limit, 100);
let continued = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
nodes(continued.props.ListHeaderComponent)
	.find((node) => node.type === "CollectionHeader")
	.props.onChangeText("changed locally");
render(DocumentsLibrary);
advance(300);
render(DocumentsLibrary);
assert.equal(documentInput.q, "changed locally");
libraryParams = { q: "rx112overflow", type: "letter" };
render(DocumentsLibrary);
render(DocumentsLibrary);
advance(300);
render(DocumentsLibrary);
assert.equal(documentInput.q, "rx112overflow");
assert.equal(documentInput.type, "letter");
assert.equal(libraryParams.q, undefined);
assert.equal(libraryParams.type, undefined);
console.log("PASS native repeatable query/type continuation into an already-mounted paginated library");

// Tag filters never exceed the server limit, and selected chips stay removable.
hooks.length = 0;
documentQuery.isError = false;
documentQuery.data.tags = Array.from({ length: 21 }, (_, index) => `tag${index}`);
for (let index = 0; index < 21; index++) {
	const tree = render(DocumentsLibrary);
	nodes(nodes(tree).find((node) => node.type === "FlatList").props.ListHeaderComponent)
		.find((node) => node.type === "Chip" && node.props.label === `tag${index}`)
		.props.onPress();
	render(DocumentsLibrary);
	assert.ok(documentInput.tags.length <= 20, "Tag chip must not generate an invalid request");
}
nodes(nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList").props.ListHeaderComponent)
	.find((node) => node.type === "Chip" && node.props.label === "tag0")
	.props.onPress();
render(DocumentsLibrary);
assert.equal(documentInput.tags.length, 19);
nodes(nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList").props.ListHeaderComponent)
	.find((node) => node.type === "Chip" && node.props.label === "tag20")
	.props.onPress();
render(DocumentsLibrary);
assert.ok(documentInput.tags.includes("tag20"));
documentQuery.data.tags = [];
console.log("PASS native tag filter bound and removal recovery");

// A large library renders only its server page. Navigation replaces rows and filters restart at zero.
hooks.length = 0;
documentQuery.isError = false;
documentQuery.data.items = Array.from({ length: 100 }, (_, index) => ({
	id: `doc-${index}`,
	type: "resume",
	tags: [],
}));
let library = render(DocumentsLibrary);
let list = nodes(library).find((node) => node.type === "FlatList");
assert.equal(list.props.data.length, 100);
assert.equal(documentInput.limit, 100);
assert.equal(documentInput.offset, 0);
nodes(list.props.ListFooterComponent)
	.find((node) => node.props.label === "Next")
	.props.onPress();
library = render(DocumentsLibrary);
assert.equal(documentInput.offset, 100);
list = nodes(library).find((node) => node.type === "FlatList");
nodes(list.props.ListHeaderComponent)
	.find((node) => node.type === "CollectionHeader")
	.props.onChangeText("design");
render(DocumentsLibrary);
assert.equal(documentInput.q, "");
list = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
let retained = nodes(list.props.renderItem({ item: list.props.data[0], index: 0 })).find(
	(node) => node.type.name === "DocumentItem",
);
assert.equal(retained.props.busy, true, "Raw search disables retained rows before debounce");
retained.props.onSelect();
retained.props.onMenu();
retained.props.onTrash();
retained.props.onDuplicate();
list = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
retained = nodes(list.props.renderItem({ item: list.props.data[0], index: 0 })).find(
	(node) => node.type.name === "DocumentItem",
);
assert.equal(retained.props.selecting, false, "Disabled selection callback cannot enter selection mode");
advance(300);
render(DocumentsLibrary);
assert.equal(documentInput.q, "design");
assert.equal(documentInput.offset, 0);
render(DocumentsLibrary);
assert.equal(documentInput.offset, 0);
pendingDocuments = [
	{ type: "resume", id: "doc-0", name: "Visible queued work" },
	{ type: "letter", id: "off-page", name: "Other queued work" },
];
list = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
for (const document of pendingDocuments)
	assert.ok(
		nodes(list.props.ListHeaderComponent).some((node) => node.type === "ListRow" && node.props.title === document.name),
	);
assert.equal(
	documentPlaceholder(documentQuery.data, { queryKey: ["document-page", {}, "another-account"] }),
	undefined,
);
assert.equal(
	documentPlaceholder(documentQuery.data, { queryKey: ["document-page", {}, "fixture"] }),
	documentQuery.data,
);
pendingDocuments = Array.from({ length: 201 }, (_, id) => ({ type: "letter", id: String(id), name: `Queued ${id}` }));
list = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
assert.equal(
	nodes(list.props.ListHeaderComponent).filter(
		(node) => node.type === "ListRow" && node.props.title?.startsWith("Queued "),
	).length,
	100,
);
nodes(list.props.ListHeaderComponent)
	.find((node) => node.props.label === "Next unsynced drafts")
	.props.onPress();
list = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
assert.ok(nodes(list.props.ListHeaderComponent).some((node) => node.props.title === "Queued 100"));
assert.ok(!nodes(list.props.ListHeaderComponent).some((node) => node.props.title === "Queued 0"));
pendingDocuments = [];
console.log("PASS native large-library page bound, navigation, debounced filter reset and account-scoped recovery");

for (const trashed of [false, true]) {
	hooks.length = 0;
	documentQuery.isPlaceholderData = false;
	documentQuery.isError = false;
	const previousPage = documentQuery.data;
	list = nodes(render(DocumentsLibrary, { trashed })).find((node) => node.type === "FlatList");
	documentQuery.isPlaceholderData = true;
	list = nodes(render(DocumentsLibrary, { trashed })).find((node) => node.type === "FlatList");
	retained = nodes(list.props.renderItem({ item: list.props.data[0], index: 0 })).find(
		(node) => node.type.name === "DocumentItem",
	);
	assert.equal(retained.props.busy, true);
	retained.props.onSelect();
	retained.props.onTrash();
	documentQuery.isPlaceholderData = false;
	documentQuery.isError = true;
	documentQuery.data = undefined;
	list = nodes(render(DocumentsLibrary, { trashed })).find((node) => node.type === "FlatList");
	assert.equal(list.props.data.length, 100, "Failed replacement retains last-successful rows");
	assert.ok(nodes(list.props.ListHeaderComponent).some((node) => node.type === "CollectionHeader"));
	retained = nodes(list.props.renderItem({ item: list.props.data[0], index: 0 })).find(
		(node) => node.type.name === "DocumentItem",
	);
	assert.equal(retained.props.busy, true);
	assert.equal(retained.props.selecting, false);
	documentQuery.data = previousPage;
}
documentQuery.isError = false;
console.log(
	"PASS native live/Trash retained rows block callbacks during debounce, placeholders and failed replacement",
);

// The Trash sheet's Restore brings the document back; it must never reach for another operation such as Delete.
hooks.length = 0;
const originalDocumentQuery = documentQuery;
const sheetDocument = { type: "resume", id: "restore-sheet", trashedAt: new Date(), name: "Restore fixture" };
documentQuery = { ...originalDocumentQuery, data: { ...originalDocumentQuery.data, items: [sheetDocument], total: 1 } };
render(DocumentsLibrary, { trashed: true });
const trashList = nodes(render(DocumentsLibrary, { trashed: true })).find((node) => node.type === "FlatList");
assert.equal(trashList.props.data[0].document, sheetDocument);
nodes(trashList.props.renderItem({ item: trashList.props.data[0], index: 0 }))
	.find((node) => typeof node.props.onMenu === "function")
	.props.onMenu();
const restoreSheet = nodes(render(DocumentsLibrary, { trashed: true })).find(
	(node) => typeof node.props.onRestore === "function",
);
assert.ok(restoreSheet);
restoreSheet.props.onRestore(sheetDocument);
await new Promise(setImmediate);
assert.deepEqual(restoredFromSheet, [[sheetDocument]]);
documentQuery = originalDocumentQuery;
hooks.length = 0;
console.log("PASS native Trash-sheet Restore restores the chosen document");

// Browse every printable glyph, search beyond the old 60-result cap, select and clear.
const iconDirectory = new URL("../../../packages/pdf/src/forme/phosphor-icons/", import.meta.url);
const iconPaths = Object.assign(
	{},
	...readdirSync(iconDirectory)
		.filter((file) => file.endsWith(".json"))
		.map((file) => JSON.parse(readFileSync(new URL(file, iconDirectory)))),
);
const resumeIcons = load("../../../packages/schema/src/icons.ts").icons;
const { IconPickerSheet } = load("features/write/pickers.tsx", {
	"react-native-svg": { SvgXml: "SvgXml" },
	"@reactive-resume/pdf/icons": { default: iconPaths, __esModule: true },
	"@reactive-resume/schema/icons": { icons: resumeIcons },
	"@/ui": { ...ui, Sheet: "Sheet", TextField: "TextField", ListRow: "ListRow" },
});
hooks.length = 0;
const pickerProps = { open: true, value: "github-logo", onClose() {}, onChange() {} };
const pickerList = (props = pickerProps) =>
	nodes(render(IconPickerSheet, props)).find((node) => node.type === "FlatList");
let picker = pickerList();
assert.deepEqual(new Set(picker.props.data), new Set(["", ...Object.keys(iconPaths)]));
const search = (query) => {
	const tree = render(IconPickerSheet, pickerProps);
	nodes(tree)
		.find((node) => node.type === "TextField")
		.props.onChangeText(query);
	return pickerList();
};
picker = search(" Arrow ");
assert.ok(picker.props.data.length > 60, "Search must not truncate large result sets");
assert.ok(picker.props.data.every((name) => !name || name.includes("arrow")));

// An unknown decorative icon crashes its entire screen, including rows accepting ReactNode leading content.
const { Icon: NativeIcon } = load(
	"ui/icon.tsx",
	Object.fromEntries(
		[
			...readFileSync(new URL("../src/ui/icon.tsx", import.meta.url), "utf8").matchAll(
				/import \{ (\w+) \} from "(phosphor-react-native\/src\/icons\/[^"]+)"/g,
			),
		].map(([, symbol, path]) => [path, { [symbol]: symbol }]),
	),
);
for (const directory of [new URL("../src/", import.meta.url), new URL("../app/", import.meta.url)]) {
	for (const path of readdirSync(directory, { recursive: true }).filter((path) => path.endsWith(".tsx"))) {
		const source = readFileSync(new URL(path, directory), "utf8");
		for (const pattern of [/\b(?:icon|leading)="([^"]+)"/g, /<Icon\b[^>]*\bname="([^"]+)"/g]) {
			for (const [, name] of source.matchAll(pattern)) {
				assert.ok(NativeIcon({ name }).type, `${path}: icon "${name}" must resolve before its screen renders`);
			}
		}
	}
}
picker = search("no-such-icon");
assert.deepEqual(picker.props.data, [""]);
console.log(
	"PASS every literal icon resolves and the icon picker offers every printable glyph with untruncated search",
);
