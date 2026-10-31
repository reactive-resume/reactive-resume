// Run: node apps/mobile/scripts/layout.test.mjs
// Execute shipped layout components; native measurements and navigation are boundary fixtures.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
let window = { width: 951, height: 669, fontScale: 1 };
let insets = { top: 0, bottom: 20, left: 0, right: 84 };
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
const tag = (parts, ...values) =>
	Array.isArray(parts) ? parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "") : parts.message;
const routes = {
	documents: () => "/documents",
	trash: () => "/documents/trash",
	new: () => "/new",
	search: () => "/search",
	settings: (page) => `/settings/${page}`,
};
const mocks = {
	react,
	"react-native": native,
	"react-native-safe-area-context": safe,
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"expo-router": {
		useLocalSearchParams: () => ({}),
		useRouter: () => router,
		usePathname: () => "/documents",
	},
	"expo-observe": { useObserve: () => ({ markInteractive() {} }) },
	"react-native-keyboard-controller": { KeyboardAwareScrollView: "ScrollView", useKeyboardState: () => false },
	"react-native-reanimated": { useAnimatedReaction: (prepare, react) => effects.push(() => react(prepare(), null)) },
	"react-native-worklets": { scheduleOnRN: (run, ...args) => run(...args) },
	"@/routes": { routes },
};
let keyboardHeight = 0;
mocks["react-native-keyboard-controller"].useKeyboardState = (select) =>
	select({ height: keyboardHeight, isVisible: keyboardHeight > 0 });
mocks["react-native-keyboard-controller"].useReanimatedKeyboardAnimation = () => ({
	height: { get: () => keyboardHeight },
});
function load(path, extra = {}) {
	const module = { exports: {} };
	const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
	const code = transformSync(source, {
		loader: path.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	}).code;
	const dependencies = { ...mocks, ...extra };
	new Function("React", "require", "module", "exports", code)(
		react,
		(name) => {
			assert.ok(name in dependencies, `Missing boundary fixture: ${name}`);
			return dependencies[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
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
const resizedKeyboard = keyboardLayout.KeyboardFrame({}).type;
for (const height of [0, 300, 200]) {
	keyboardHeight = height;
	resizedKeyboard.current = false;
	assert.equal(keyboardLayout.useKeyboardScrollSpace() + height, height, "Overlaid keyboards need scroll space");
	resizedKeyboard.current = true;
	assert.equal(
		keyboardLayout.useKeyboardScrollSpace() + height,
		0,
		"Resized viewports must not add keyboard space twice",
	);
}
resizedKeyboard.current = false;
keyboardHeight = 0;
const { Screen } = load("ui/text.tsx");
const { TopBar } = load("shell/top-bar.tsx");
const { AppSidebar } = load("shell/app-tabs.tsx", { "react-native-reanimated": {} });
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props.children)];
const expanded = (tree) =>
	!tree || typeof tree !== "object"
		? tree
		: Array.isArray(tree)
			? tree.map(expanded)
			: typeof tree.type === "function"
				? expanded(tree.type(tree.props))
				: { ...tree, props: { ...tree.props, children: expanded(tree.props.children) } };

// Navigation follows window width; content measurements account for cutouts and sidebars.
for (const [width, right, expected] of [
	[466, 84, false],
	[951, 84, true],
	[669, 0, false],
	[750, 84, true],
]) {
	window = { ...window, width };
	insets = { ...insets, right };
	assert.equal(isTablet(), expected);
}
for (const scroll of [false, true]) {
	const measure = () => {};
	const screen = Screen({ scroll, edges: ["top"], onLayout: measure });
	assert.equal(screen.props.style.paddingLeft, insets.left);
	assert.equal(screen.props.style.paddingRight, insets.right);
	assert.equal(screen.props.style.paddingTop, insets.top);
	assert.equal(nodes(screen).find((node) => node.props.onLayout === measure).props.onLayout, measure);
}
const { WindowSafeAreaProvider, useWindowSafeAreaInsets: windowInsets } = load("ui/safe-area.tsx");
const provider = WindowSafeAreaProvider({ children: null });
provider.type.current = provider.props.value;
insets = { ...insets, left: 0, right: 0 };
assert.equal(Screen({}).props.style.paddingRight, 0, "Pane must not consume window insets twice");
assert.equal(windowInsets().right, 84, "Portalled sheets must retain original window cutout");
const state = {
	index: 0,
	routes: ["documents", "applications", "create", "career", "settings"].map((name) => ({ name, key: name })),
};
const titles = { documents: "Documents", applications: "Applications", career: "Career", settings: "Settings" };
const props = {
	state,
	insets,
	descriptors: Object.fromEntries(state.routes.map(({ key }) => [key, { options: { title: titles[key] ?? key } }])),
	emitter: { emit: () => ({ defaultPrevented: false }) },
	navigateToTab: (key) => calls.push(key),
};
window = { width: 951, height: 669, fontScale: 1 };
insets = { top: 0, left: 0, right: 84, bottom: 20 };
props.insets = insets;
const rail = expanded(AppSidebar(props));
assert.ok(rail.props.style.width < tokens.size.sidebar / 2, "Opened Duo must retain most width for content");
assert.ok(
	nodes(rail).some((node) => node.type === "ScrollView"),
	"Short windows must keep navigation reachable",
);
for (const label of ["Documents", "Applications", "Career", "Settings", "Trash", "New", "Account"]) {
	const action = nodes(rail).find((node) => node.type === "Pressable" && node.props.accessibilityLabel === label);
	assert.ok(action, `Missing rail action ${label}`);
	assert.ok(action.props.style({ pressed: false }).minHeight >= 44);
	assert.equal(action.props.accessibilityRole, ["New", "Account"].includes(label) ? "button" : "tab");
	if (label !== "Documents") action.props.onPress();
}
assert.deepEqual(calls, ["applications", "career", "settings", "/documents/trash", "/new", "/settings/account"]);
window = { ...window, width: 750 };
insets = { ...insets, right: 0 };
window = { ...window, width: 951, fontScale: 1.8 };
assert.ok(AppSidebar(props).props.style.width > rail.props.style.width, "Enlarged labels need wider rail");
window = { ...window, width: 750, fontScale: 1 };
native.I18nManager.isRTL = true;
window = { ...window, width: 951 };
props.insets = { ...props.insets, right: 84 };
assert.equal(AppSidebar(props).props.style.width, rail.props.style.width + 84);
assert.equal(AppSidebar(props).props.style.paddingStart, 84 + tokens.space.s3);
native.I18nManager.isRTL = false;
window = { ...window, width: 750 };
const modes = element("Modes", {});
const topBar = () => TopBar({ backLabel: "Back", onBack() {}, title: "Long fictional resume title", center: modes });
const primary = () => topBar().props.children[0];
assert.equal(
	nodes(primary()).some((node) => node.type === "Modes"),
	false,
	"Narrow header must keep modes out of action row",
);
assert.ok(nodes(topBar()).some((node) => node.type === "Modes"));
window = { ...window, width: 1366 };
insets = { ...insets, right: 0 };
props.insets = insets;
assert.equal(AppSidebar(props).props.style.width, tokens.size.sidebar, "Large tablets retain full sidebar");
assert.ok(nodes(primary()).some((node) => node.type === "Modes"));
window = { ...window, fontScale: 1.8 };
assert.equal(
	nodes(primary()).some((node) => node.type === "Modes"),
	false,
	"Enlarged text needs separate mode row",
);
ui.useReducedMotion = () => false;
mocks["@/shell/use-is-tablet"] = { useIsTablet: isTablet };
mocks["expo-router"].Stack = { Screen: "Stack.Screen" };
const { useTabStackOptions: stackOptions } = load("shell/app-banner.tsx");
const { SettingsPage } = load("features/settings/layout.tsx");
for (const [width, largeTitle] of [
	[951, false],
	[466, true],
]) {
	window = { ...window, width };
	assert.equal(stackOptions().headerLargeTitle, largeTitle);
	const settings = SettingsPage({ title: "Settings", root: true, children: null });
	assert.equal(nodes(settings).find((node) => node.type === "Stack.Screen").props.options.headerShown, false);
	assert.ok(nodes(settings).some((node) => node.type === "CollectionHeader" && node.props.title === "Settings"));
	const pushed = SettingsPage({ title: "Account", children: null });
	assert.equal(nodes(pushed).find((node) => node.type === "Stack.Screen").props.options.headerShown, true);
}
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
native.ActivityIndicator = "ActivityIndicator";
native.PixelRatio = { get: () => 2 };
const rasterScales = [];
const { OriginalPage } = load("features/ats-checker/original-page.tsx", {
	"expo-image": { Image: "Image" },
	"expo-file-system": {
		File: class {
			async arrayBuffer() {
				return new ArrayBuffer(0);
			}
		},
	},
	"../../../modules/pdf-pages": {
		pdfPages: {
			open: async () => ({ id: "fictional", pages: [{ width: 595, height: 842 }] }),
			close: async () => {},
			rasterize: async (_id, _pages, scale) => {
				rasterScales.push(scale);
				return [{ index: 0, width: 595, height: 842, uri: "file://fictional.png" }];
			},
		},
	},
});
const original = () => {
	cursor = 0;
	effects = [];
	const tree = OriginalPage({ uri: "file://fictional.pdf" });
	for (const effect of effects) effect();
	return tree;
};
let page = original();
assert.equal(rasterScales.length, 0, "Do not rasterize until container is measured");
for (const width of [350, 620, 350]) {
	page.props.onLayout({ nativeEvent: { layout: { width } } });
	original();
	await new Promise(setImmediate);
	page = original();
	assert.equal(nodes(page).find((node) => node.type === "Image").props.style.width, width);
	assert.equal(rasterScales.at(-1), (width * 2) / 595);
}
hooks.at(-1).cleanup?.();
hooks.length = 0;
const version = { id: "version", kind: "created", createdAt: new Date(0) };
const { HistoryPanel } = load("features/history/history.tsx", {
	"@lingui/core/macro": { t: tag },
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-US" } }) },
	"@tanstack/react-query": { useQuery: () => ({ data: [version] }) },
	"expo-image": { Image: "Image" },
	"expo-router": { useLocalSearchParams: () => ({ version: version.id }) },
	"@/api/client": { client: {}, orpc: { resume: { listVersions: { queryOptions: () => ({}) } } } },
	"@/draft": { getDraftScope: async () => "fixture", useResumeStore: {} },
	"@/features/documents/queries": { useDocumentOperations: () => ({ busy: false }) },
	"@/features/share/document": { flushResume: async () => {} },
	"@/preview/usePreview": { usePreview: () => ({ result: null }) },
});
const history = () => {
	cursor = 0;
	return HistoryPanel({ resume: { id: "fictional", isLocked: false }, offline: false });
};
let panel = history();
for (const width of [650, 380, 650]) {
	panel.props.onLayout({ nativeEvent: { layout: { width } } });
	panel = history();
	assert.equal(panel.props.style.flexDirection, width >= 540 ? "row-reverse" : "column");
}

// Large text must reflow chrome without taking scrolling content or row titles out of reach.
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
// Native nested headers clear the status bar only on phones; the tablet top bar already clears it.
const builderStack = { Screen: "Stack.Screen" };
const { BuilderChrome } = load("shell/builder-chrome.tsx", {
	"expo-router": {
		useRouter: () => router,
		useNavigation: () => ({}),
		useSegments: () => ["builder", "fictional", "basics"],
		Stack: builderStack,
	},
	"./app-banner": { AppStrip: "AppStrip" },
	"./app-tabs": { Bar: "Bar", BarItem: "BarItem" },
	"./key-commands": { useKeyCommands() {} },
	"./slot": { createSlot: () => ({ Provider: "SlotProvider", useFill() {} }) },
	"./top-bar": { TopBar },
});
const builderProps = {
	panes: [{ pane: "write", label: "Write", icon: "pencil", href: "/write" }],
	tabletPanes: ["write"],
	page: element("Preview", {}),
	title: "Fictional resume",
};
const builderFrame = nodes(BuilderChrome(builderProps)).find((node) => typeof node.type === "function");
hooks.length = 0;
insets = { top: 48, bottom: 32, left: 0, right: 0 };
for (const width of [443, 852, 443, 852]) {
	window = { width, height: 883, fontScale: 1 };
	for (const visible of [false, true, false]) {
		keyboardHeight = visible ? 300 : 0;
		render(builderFrame.type, builderProps);
		const tree = render(builderFrame.type, builderProps);
		const stack = nodes(tree).find((node) => node.type === builderStack);
		assert.equal(
			stack.props.screenOptions({ route: { name: "basics" } }).unstable_nativeProps?.headerConfig
				?.disableTopInsetApplication,
			width >= 750,
			"Fold transitions must switch native header insets without changing the route",
		);
		const preview = nodes(tree).find(
			(node) =>
				nodes(node.props.children).some((child) => child.type === "Preview") &&
				node.props.style?.paddingBottom !== undefined,
		);
		if (width >= 750) {
			assert.equal(
				preview.props.style.paddingBottom,
				visible ? 0 : 32,
				"Keyboard replaces the preview's bottom safe area",
			);
		} else {
			assert.equal(preview, undefined, "Phones keep preview in its own pane");
		}
	}
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
		useMemo: (compute) => compute(),
		useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
	},
	"@lingui/core/macro": { plural: () => "characters" },
	"react-native-enriched-html": { EnrichedTextInput: "RichInput" },
	"./rich-text": richText,
	"./improve": { ImprovePanel: "ImprovePanel" },
	"./pickers": { PromptSheet: "PromptSheet" },
	"@/draft": { resumeFieldFocus: { onFocus() {}, onBlur() {} } },
});
for (const text of ["Existing line", ""]) {
	hooks.length = 0;
	const field = render(RichTextField, { label: "Summary", value: `<p>${text}</p>`, onChange() {} });
	const input = nodes(field).find((node) => node.type === "RichInput");
	input.props.onChangeText({ nativeEvent: { value: text } });
	input.props.onFocus();
	const toolbar = render(RichTextToolbar);
	for (const height of [300, 0]) {
		keyboardHeight = height;
		render(RichTextToolbar);
		const dock = nodes(render(RichTextToolbar)).find((node) => node.props.accessibilityRole === "toolbar");
		assert.equal(dock.props.style.paddingBottom, height ? 0 : insets.bottom, "Hardware-keyboard tools clear gestures");
	}
	keyboardHeight = 0;
	const improve = nodes(toolbar).find((node) => node.props.label === "Improve selected line");
	assert.equal(improve.props.disabled, text === "", "First focus enables Improve only for nonempty lines");
	if (text) {
		const commands = [];
		input.props.ref.current = {
			toggleUnderline: () => commands.push("underline"),
			toggleStrikeThrough: () => commands.push("strikethrough"),
			focus: () => commands.push("focus"),
		};
		for (const [title, command] of [
			["Underline", "underline"],
			["Strikethrough", "strikethrough"],
		]) {
			nodes(render(RichTextToolbar))
				.find((node) => node.props.label === "Text style")
				.props.onPress();
			const menu = nodes(render(RichTextToolbar)).find((node) => node.props.title === "Text style");
			assert.equal(menu.props.open, true);
			nodes(menu)
				.find((node) => node.props.title === title)
				.props.onPress();
			assert.deepEqual(commands.splice(0), [command, "focus"], "Text style preserves formatting and returns focus");
			assert.equal(nodes(render(RichTextToolbar)).find((node) => node.props.title === "Text style").props.open, false);
		}
	}
	input.props.onBlur();
}
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
const componentFixtures = {
	"./button": ui,
	"./icon": ui,
	"./motion": ui,
	"./pressable": { FeedbackPressable: "Pressable" },
	"./text": ui,
	"expo-image": { Image: "Image" },
	"react-native-reanimated": animation,
};
const { CollectionHeader } = load("components/collection-header.tsx");
const { ListRow, EmptyState } = load("ui/layout.tsx", componentFixtures);
const { Segmented } = load("ui/fields.tsx", {
	...componentFixtures,
	"./layout": { ListRow },
	"./overlays": { Sheet: "Sheet" },
	"./switch": { Switch: "Switch" },
	"@reactive-resume/utils/string": { filterOptions: (options) => options },
});
const { BarItem } = load("shell/app-tabs.tsx", { "react-native-reanimated": animation });
let knowledgeParams = {};
const { KnowledgeScreen } = load("features/career/knowledge.tsx", {
	"expo-router": {
		useLocalSearchParams: () => knowledgeParams,
		useRouter: () => ({
			setParams: (next) => {
				knowledgeParams = next;
			},
		}),
	},
	"./facts": { Facts: "Facts" },
	"./stories": { Stories: "Stories" },
	"./preferences": { Preferences: "Preferences" },
	"./shared": { LoadState: "LoadState" },
	"./hooks": { useCareerQueries: () => ({ profile: {} }) },
	"@/auth/session": { useSession: () => ({ server: "fixture" }) },
	"@/ui": { ...ui, Screen: "Screen", Segmented: "Segmented" },
});
native.FlatList = "FlatList";
const documentQuery = { data: [], isError: false, refetch() {} };
const { DocumentsLibrary } = load("features/documents/library.tsx", {
	"@legendapp/list/reanimated": { AnimatedLegendList: "FlatList" },
	"./document-sheets": { DocumentSheets: "DocumentSheets" },
	"./filter": load("features/documents/filter.ts"),
	"./new-documents": {},
	"./pending": { usePendingDocuments: () => [] },
	"./queries": { useDocuments: () => documentQuery, useDocumentOperations: () => ({ busy: false }) },
	"./thumbnail": { Thumbnail: "Thumbnail" },
	"@/api/client": { client: {}, orpc: { documents: { counts: { queryOptions: () => ({ queryKey: [] }) } } } },
	"@/auth/session": { useSession: () => ({ status: "signed-in", server: "fixture" }) },
	"@/components/collection-header": { CollectionHeader: "CollectionHeader" },
	"@tanstack/react-query": { useQuery: () => ({ data: { trash: 0 }, refetch() {} }) },
	"expo-haptics": {},
	"expo-router": { ...mocks["expo-router"], useFocusEffect() {} },
	"@lingui/core/macro": { plural: (count, options) => options[count === 1 ? "one" : "other"].replace("#", count) },
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
	},
});
// Changing library columns remounts its header; an active filter must remain visible and clearable.
hooks.length = 0;
let restoredSearch = "Fold QA duplicate";
const searchedHeader = render(CollectionHeader, {
	title: "Documents",
	searchLabel: "Search documents",
	placeholder: "Search",
	value: restoredSearch,
	onChangeText(value) {
		restoredSearch = value;
	},
});
assert.equal(nodes(searchedHeader).find((node) => node.type === "TextInput")?.props.value, restoredSearch);
assert.equal(
	nodes(searchedHeader).find((node) => node.type === "TextInput").props.autoFocus,
	false,
	"Restoring an active filter must not summon the keyboard",
);
nodes(searchedHeader)
	.find((node) => node.props.label === "Close search")
	.props.onPress();
assert.equal(restoredSearch, "");

for (const fontScale of [1, 1.95, 3.12]) {
	window = { width: 320, height: 568, fontScale };
	hooks.length = 0;
	const header = render(CollectionHeader, {
		title: "Documents",
		searchLabel: "Search documents",
		placeholder: "Search",
		value: "",
		onChangeText() {},
		actions: element("NewDocument", {}),
	});
	assert.equal(header.props.style.flexDirection, fontScale > 1.3 ? "column" : "row");
	assert.ok(nodes(header).some((node) => node.type === "NewDocument"));
	const row = render(ListRow, {
		title: "Preferences",
		value: "System",
		leading: "circle-half",
		chevron: true,
		trailing: element("Switch", {}),
	});
	const title = nodes(row).find((node) => node.props.children?.includes("Preferences"));
	const content = nodes(row).find((node) => node.props.children?.includes(title));
	const rowStyle = typeof row.props.style === "function" ? row.props.style({ pressed: false }) : row.props.style;
	assert.equal(rowStyle.flexDirection, fontScale > 1.3 ? "column" : "row");
	if (fontScale > 1.3) {
		assert.equal(rowStyle.alignItems, "stretch", "Large row titles need full width");
		assert.equal(
			nodes(content).some((node) => node.type === "Icon"),
			false,
		);
		const leading = nodes(row).find((node) => node.props.name === "circle-half");
		const band = nodes(row).find((node) => node.props.children?.includes(leading));
		assert.ok(nodes(band).some((node) => node.props.name === "caret-right"));
	}
	assert.equal(
		nodes(content).some((node) => node.type === "Switch"),
		fontScale > 1.3,
	);
	const values = nodes(row).filter((node) => node.props.children?.includes("System"));
	assert.equal(values.length, 1);
	if (fontScale > 1.3) assert.equal(values[0].props.numberOfLines, undefined);
	hooks.length = 0;
	const knowledge = render(KnowledgeScreen);
	const choice = nodes(knowledge).find((node) => node.type === "Segmented");
	assert.ok(choice, "Three Knowledge choices must remain inline");
	const segments = render(Segmented, choice.props);
	assert.equal(segments.props.style.flexDirection, fontScale > 1.3 ? "column" : "row");
	choice.props.onChange("preferences");
	assert.equal(
		nodes(render(KnowledgeScreen)).find((node) => node.type === "Segmented").props.value,
		"preferences",
		"Profile navigation must reopen Preferences even when Knowledge is already mounted",
	);
	knowledgeParams = {};
	for (const label of ["Documents", "Applications", "Career", "Settings", "Podania o pracę", "தொழில் வாழ்க்கை"]) {
		const item = render(BarItem, { label, icon: "file-text", focused: false, onPress() {} });
		const text = nodes(item).find((node) => node.props.children?.includes(label));
		assert.equal(text.props.numberOfLines, label.split(" ").length, "Translated phrases must retain room to wrap");
		assert.equal(text.props.adjustsFontSizeToFit, true, "Long navigation words must fit their cells");
		assert.equal(text.props.minimumFontScale, 0.7);
		assert.equal(item.props.accessibilityLabel, label);
	}
	for (const isError of [false, true]) {
		hooks.length = 0;
		documentQuery.isError = isError;
		const library = render(DocumentsLibrary);
		const list = nodes(library).find((node) => node.type === "FlatList");
		const chrome = list.props.ListHeaderComponent;
		assert.ok(nodes(chrome).some((node) => node.type === "CollectionHeader"));
		assert.equal(
			nodes(chrome).some((node) => node.type === "Banner"),
			isError,
		);
		if (fontScale > 1.3) {
			const sort = nodes(chrome).find((node) => node.type === "ListRow" && node.props.title === "Sort");
			assert.ok(sort, "Large-text sort must fit a bounded row");
			assert.equal(sort.props.value, "Last edited");
			for (const strip of nodes(chrome).filter((node) => node.type === "ScrollView" && node.props.horizontal))
				assert.equal(nodes(strip).includes(sort), false, "Sort must not clip inside horizontal chip strip");
			sort.props.onPress();
			const updated = nodes(render(DocumentsLibrary)).find((node) => node.type === "FlatList");
			assert.equal(
				nodes(updated.props.ListHeaderComponent).find((node) => node.type === "ListRow" && node.props.title === "Sort")
					.props.value,
				"Name",
			);
		}
	}
}

// A direct link to a later workspace tab must reveal its selection and offer overflow navigation.
hooks.length = 0;
let selectedTab = "saved";
const scrolled = [];
const { WorkspaceChrome } = load("shell/workspace-chrome.tsx", {
	"./slot": { createSlot: () => ({ Provider: "SlotProvider", useSlot: () => ({}) }) },
	"./top-bar": { TopBar: "TopBar" },
	"@reactive-resume/schema/career": {
		WORKSPACE_TABS: ["fit", "apply", "prepare", "practise", "debrief", "messages", "saved"],
	},
	"expo-router": {
		...mocks["expo-router"],
		useNavigation: () => ({ canGoBack: () => false }),
		useLocalSearchParams: () => ({ id: "fictional" }),
		useGlobalSearchParams: () => ({ tab: selectedTab }),
	},
});
const frame = WorkspaceChrome({ children: null }).props.children[0];
let workspace = render(frame.type, frame.props);
const strip = () => nodes(workspace).find((node) => node.type === "ScrollView");
strip().props.ref.current = { scrollTo: (value) => scrolled.push(value.x) };
strip().props.onLayout({ nativeEvent: { layout: { width: 280 } } });
strip().props.onContentSizeChange(840, 44);
workspace = render(frame.type, frame.props);
for (const [index, tab] of nodes(workspace)
	.filter((node) => node.type === "Pressable")
	.entries()) {
	tab.props.onLayout({ nativeEvent: { layout: { x: index * 120, width: 120 } } });
}
assert.equal(scrolled.at(-1), 560, "Later tab must be visible after its first measurement");
strip().props.onScroll({ nativeEvent: { contentOffset: { x: 560 } } });
workspace = render(frame.type, frame.props);
assert.ok(nodes(workspace).some((node) => node.props.label === "Previous workspace tabs" && !node.props.disabled));
assert.ok(nodes(workspace).some((node) => node.props.label === "Next workspace tabs" && node.props.disabled));
selectedTab = "apply";
workspace = render(frame.type, frame.props);
assert.equal(scrolled.at(-1), 40, "Changing route must reveal the selected tab again");
assert.ok(nodes(workspace).some((node) => node.type === keyboardLayout.KeyboardFrame));
selectedTab = "details";
hooks.length = 0;
assert.equal(
	nodes(render(frame.type, frame.props)).some((node) => node.type === keyboardLayout.KeyboardFrame),
	false,
	"Application details keep their own full-height scroll space outside workspace keyboard resizing",
);
console.log(
	"PASS safe areas, measured Screen viewport, Duo rail navigation/targets, tablet sidebar, responsive editor modes, history split, measured PDF pages, large-text chrome/rows/navigation, workspace selection and overflow",
);

// Long empty-state headings need bounded width before Android measures wrapped text.
for (const title of ["All your applications are closed", "Your job search starts here"]) {
	const empty = render(EmptyState, { title });
	const heading = nodes(empty).find((node) => node.props.accessibilityRole === "header");
	assert.equal(heading.props.children[0], title);
	assert.equal(heading.props.style.alignSelf, "stretch");
	assert.equal(heading.props.numberOfLines, undefined);
}

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
const selections = [];
const pickerProps = { open: true, value: "github-logo", onClose() {}, onChange: (name) => selections.push(name) };
const pickerList = (props = pickerProps) =>
	nodes(render(IconPickerSheet, props)).find((node) => node.type === "FlatList");
let picker = pickerList();
assert.deepEqual(new Set(picker.props.data), new Set(["", ...Object.keys(iconPaths)]));
assert.ok(picker.props.data.length > 1500);
for (const name of picker.props.data) {
	const cell = picker.props.renderItem({ item: name });
	assert.equal(cell.props.accessibilityLabel, name || "None");
	assert.equal(cell.props.accessibilityState.checked, name === pickerProps.value);
	assert.equal(
		nodes(cell).some((node) => node.type === "Text"),
		false,
		"Grid cells must show glyphs without names",
	);
	if (name)
		assert.ok(
			nodes(cell)
				.find((node) => node.type === "SvgXml")
				.props.xml.includes(iconPaths[name]),
		);
}
for (const width of [240, 480, 320]) {
	picker.props.onLayout({ nativeEvent: { layout: { width } } });
	picker = pickerList();
	const cellWidth = width / picker.props.numColumns;
	assert.ok(cellWidth >= theme.size.hit, "Grid preserves minimum touch target on narrow screens");
}
picker.props.renderItem({ item: "github-logo" }).props.onPress();
picker.props.renderItem({ item: "" }).props.onPress();
assert.deepEqual(selections, ["github-logo", ""]);
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

assert.equal(
	render(ListRow, { title: "Setting", trailing: element("Switch", {}) }).props.accessible,
	false,
	"Passive rows must expose their child switches as independent accessibility controls",
);
assert.equal(render(ListRow, { title: "Setting", trailing: element("Switch", {}) }).type, "View");
assert.equal(render(ListRow, { title: "Status", value: "Saved" }).props.accessible, true);
assert.equal(render(ListRow, { title: "Open", onPress() {} }).props.accessible, true);

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
assert.ok(picker.props.ListFooterComponent);
assert.deepEqual(pickerList({ ...pickerProps, open: false }).props.data, []);
console.log("PASS wrapped empty-state titles and complete accessible searchable icon grid");
