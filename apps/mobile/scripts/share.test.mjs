import assert from "node:assert/strict";
import * as harness from "./harness.mjs";

const { mobileRequire, tag } = harness;
const element = (type, props, ...children) => ({ type, props: { ...props, children } });

let hooks = [];
let cursor = 0;
const react = {
	createElement: element,
	useState(initial) {
		const index = cursor++;
		if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
		return [hooks[index], (value) => (hooks[index] = typeof value === "function" ? value(hooks[index]) : value)];
	},
	useRef(initial) {
		const [value] = react.useState(() => ({ current: initial }));
		return value;
	},
	useEffect() {},
	useEffectEvent: (fn) => fn,
};

const ui = Object.fromEntries(
	["Banner", "Button", "Card", "Icon", "IconButton", "ListRow", "Switch", "Text", "TextField"].map((name) => [
		name,
		name,
	]),
);
ui.useTheme = () => ({
	space: { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s12: 48 },
	size: { sheetShare: 440 },
	radius: { rPill: 999 },
	colors: { ink: "#111", ink3: "#777", line: "#ddd" },
});

const load = (path, extra = {}) =>
	harness.load(`../src/${path}`, { ...mocks, ...extra }, { jsx: "transform", globals: { React: react } });

const mocks = {
	react,
	"react-native": { View: "View", Linking: {}, Share: {} },
	"react-native-qrcode-svg": "QRCode",
	"react-native-svg": { default: "Svg", Rect: "Rect" },
	"expo-clipboard": { setStringAsync: async () => {} },
	"expo-file-system": {
		File: class {
			exists = false;
			uri = "file:///cache/resume-qr-code.png";
			delete() {}
			write() {}
		},
		Paths: { cache: {} },
	},
	"expo-sharing": { isAvailableAsync: async () => true, shareAsync: async () => {} },
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"@lingui/core/macro": { t: tag },
	"@tanstack/react-query": { useQuery: () => ({ data: undefined }) },
	"./document": { flushResume: async () => ({}) },
	"./web-page": { WebPageSettings: "WebPageSettings" },
	"./feedback": { FeedbackLinks: "FeedbackLinks" },
	"@/api/flags": { useFlags: () => ({ data: {} }) },
	"@/api/client": {
		client: {},
		orpc: {
			auth: { getProfile: { queryOptions: () => ({}) } },
			resume: {
				statistics: {
					getDailyById: { queryOptions: () => ({}) },
					getById: { queryOptions: () => ({}) },
				},
			},
		},
	},
	"@/auth/session": { getServer: () => "https://test.rxresu.me" },
	"@/draft": { useResumeStore: (selector) => (typeof selector === "function" ? selector({ status: "idle" }) : "idle") },
	"@/draft/runtime": {
		draftResume: { refresh: async () => {} },
		resume: { refresh: async () => {}, writeMetadata: async (write) => write({}) },
	},
	"@/features/documents/queries": {
		documentError: (err) => String(err),
		useDocumentOperations: () => ({ busy: false, run: async (fn) => fn() }),
	},
	"@/ui": ui,
	"@/ui/use-document-operations": { useDocumentOperations: () => ({ busy: false, run: async (fn) => fn() }) },
	"@reactive-resume/resume/sharing": mobileRequire("@reactive-resume/resume/sharing"),
};

const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props?.children)];

const control = (view, label) =>
	nodes(view).find((node) => node.props?.label === label || node.props?.title === label)?.props;

function render(component, props) {
	cursor = 0;
	return component(props);
}

const { LinkTab } = load("features/share/link.tsx");

const longLegacySlug = "legacy-long-slug-over-64-characters-0123456789012345678901234567890123456789";
const legacyResume = {
	id: "res-1",
	slug: longLegacySlug,
	isPublic: true,
	isLocked: false,
};

hooks = [];
let tree = render(LinkTab, { resume: legacyResume, offline: false });
let addressProps = control(tree, "Address");
assert.ok(addressProps, "Address field must exist");
assert.equal(addressProps.value, longLegacySlug);
assert.equal(addressProps.error, undefined, "Existing legacy slug must not show error on initial load when unchanged");

// When user edits to a slug exceeding 64 chars, it shows length error
addressProps.onChangeText("a".repeat(65));
tree = render(LinkTab, { resume: legacyResume, offline: false });
addressProps = control(tree, "Address");
assert.equal(addressProps.error, "Use at most 64 characters.");

// The actual native Privacy control opts in explicitly; old cached drafts remain off, and saves use Share's queue.
const saves = [];
const { WebPageSettings } = load("features/share/web-page.tsx", {
	"./custom-domain": { CustomDomain: "CustomDomain" },
	"./revision": { setResumePassword: async () => {} },
	"expo-web-browser": { openBrowserAsync: async () => {} },
	"@/api/client": { client: {}, orpc: { resume: { list: { queryOptions: () => ({}) } } } },
});
const shareResume = { ...legacyResume, data: { metadata: {} }, isPrimary: false, hasPassword: false };
const shareProps = {
	resume: shareResume,
	offline: false,
	origin: "https://example.test",
	flags: {},
	operations: { busy: false },
	save: async (patch) => {
		saves.push(patch);
		return true;
	},
};
hooks = [];
const wordControl = (props) => control(render(WebPageSettings, props), "Visitors can download Word")?.trailing?.props;
assert.equal(wordControl(shareProps)?.value, false, "Old cached drafts must not opt into Word");
wordControl(shareProps).onValueChange(true);
assert.deepEqual(saves, [{ allowWordDownload: true }]);
assert.equal(wordControl({ ...shareProps, resume: { ...shareResume, allowWordDownload: true } }).value, true);
