// Execute the shipped raw receiver and review form; only native/session/network/UI boundaries are replaced.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const { QueryClient, QueryObserver } = mobileRequire("@tanstack/react-query");
const { ORPCError } = mobileRequire("@orpc/client");
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const zod = createRequire(new URL("../../../packages/schema/package.json", import.meta.url))("zod");
const tag = (parts, ...values) => parts.reduce((s, p, i) => s + p + (values[i] ?? ""), "");
let hooks = [];
let cursor = 0;
let effects = [];
const react = {
	createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
	useState(initial) {
		const i = cursor++;
		if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
		return [hooks[i], (v) => (hooks[i] = typeof v === "function" ? v(hooks[i]) : v)];
	},
	useRef(initial) {
		return react.useState(() => ({ current: initial }))[0];
	},
	useEffect(fn, deps) {
		const i = cursor++;
		const before = hooks[i];
		if (!before || deps.some((v, n) => v !== before.deps[n])) {
			effects.push(() => {
				before?.cleanup?.();
				hooks[i] = { deps, cleanup: fn() };
			});
		}
	},
};
const render = (component, props) => {
	cursor = 0;
	const tree = component(props);
	const pending = effects;
	effects = [];
	pending.forEach((f) => f());
	return tree;
};
const reset = () => {
	hooks.forEach((h) => h?.cleanup?.());
	hooks = [];
	cursor = 0;
	effects = [];
};
const nodes = (t) =>
	!t || typeof t !== "object" ? [] : Array.isArray(t) ? t.flatMap(nodes) : [t, ...nodes(t.props.children)];
const control = (tree, label) => {
	const node = nodes(tree).find((n) => n.props.label === label);
	assert.ok(node, label);
	return node.props;
};
const settle = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
const ui = Object.fromEntries(
	[
		"Banner",
		"Button",
		"ChipInput",
		"ConfirmDialog",
		"EditorSheet",
		"ListRow",
		"Segmented",
		"SelectSheet",
		"Text",
		"TextArea",
		"TextField",
	].map((n) => [n, n]),
);
ui.useTheme = () => ({ space: {} });
const defaults = {
	react,
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"@lingui/core/macro": { t: tag },
	"react-native": { View: "View", Platform: { OS: "ios" } },
};
function load(path, extra = {}) {
	const mod = { exports: {} };
	const code = transformSync(readFileSync(path, "utf8"), {
		loader: path.endsWith("tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	}).code;
	const dependencies = { ...defaults, ...extra };
	new Function("React", "require", "module", "exports", code)(
		react,
		(n) => {
			assert.ok(n in dependencies, `Unexpected boundary ${n}`);
			return dependencies[n];
		},
		mod,
		mod.exports,
	);
	return mod.exports;
}
const source = (path) => new URL(`../src/${path}`, import.meta.url).pathname;
const schema = (path) => new URL(`../../../packages/schema/src/applications/${path}`, import.meta.url).pathname;
const urls = load(schema("posting-url.ts"));
const capture = load(schema("capture.ts"), { zod, "./posting-url": urls });
let session = { status: "signed-in", server: "https://resume.example.test" };
let scope = "alice";
const identity = new Set();
const sessions = new Set();
const foreground = new Set();
const auth = {
	getSession: () => session,
	useSession: () => session,
	getAccountScope: () => scope,
	getServer: () => session.server,
	subscribeIdentity: (fn) => (identity.add(fn), () => identity.delete(fn)),
	subscribeSession: (fn) => (sessions.add(fn), () => sessions.delete(fn)),
};
const aiDefaults = load(new URL("../../../packages/ai/src/defaults.ts", import.meta.url).pathname);
const aiTypes = load(new URL("../../../packages/ai/src/types.ts", import.meta.url).pathname, {
	zod,
	"./defaults": aiDefaults,
});
const { authorizeAiRequest } = load(source("api/ai-consent.ts"), {
	"@reactive-resume/ai/types": aiTypes,
	"@orpc/client": { ORPCError },
	"react-native": {
		Alert: {
			alert() {
				throw new Error("No-AI reading must not ask for AI consent");
			},
		},
	},
	"@/auth/session": auth,
});
const applicationErrors = load(schema("errors.ts"));
const { applicationError } = load(source("features/applications/error.ts"), {
	"@orpc/client": { ORPCError },
	"@reactive-resume/schema/applications/errors": applicationErrors,
});
let supportFailure;
const consentApi = {
	applications: {
		findPosting: async () => {
			if (supportFailure) throw supportFailure;
			return null;
		},
	},
	aiProviders: { list: async () => [] },
};
let payloads = [];
let clears = 0;
let currentNativeScope;
let saved;
const native = {
	setIncomingShareScope(value) {
		if (currentNativeScope !== value) payloads = [];
		currentNativeScope = value;
	},
};
const { IncomingPosting } = load(source("features/applications/incoming-posting.tsx"), {
	expo: { requireOptionalNativeModule: () => native },
	"expo-sharing": {
		getSharedPayloads: () => {
			const p = payloads;
			payloads = [];
			return p;
		},
		clearSharedPayloads: () => {
			clears++;
			payloads = [];
		},
	},
	"react-native": {
		Platform: { OS: "ios" },
		AppState: { addEventListener: (_, fn) => (foreground.add(fn), { remove: () => foreground.delete(fn) }) },
		Linking: { addEventListener: () => ({ remove() {} }) },
	},
	"@reactive-resume/schema/applications/capture": capture,
	"./add-sheet": { AddApplicationSheet: "NativeReview" },
	"@/auth/session": auth,
	"@/ui": { showToast: () => {} },
});
render(IncomingPosting, {}); // establish current signed-in installation before sharing.
payloads = [{ shareType: "text", value: "x".repeat(20_001) + "\nhttps://jobs.example.test/role?jk=74" }];
foreground.forEach((f) => f("active"));
let tree = render(IncomingPosting, {});
assert.equal(tree.type, "NativeReview");
const incoming = tree.props.initialCapture;
assert.equal(incoming.description.length, 20_000);
assert.equal(incoming.truncated, true);
assert.equal(clears, 0, "new iOS native receiver consumes atomically; no second clear can delete a newer share");
const close = tree.props.onClose;
close();
render(IncomingPosting, {});
assert.equal(render(IncomingPosting, {}), null, "ordinary next activation does not replay consumed text");
reset();
let duplicateLookupError = false;
let duplicateObserver;
let hasProvider = false;
const parseRequests = [];
const lanes = [{ id: "saved", category: "saved", label: "Saved" }];
const timezoneHelpers = load(new URL("../../../packages/utils/src/timezone.ts", import.meta.url).pathname, { zod });
const { AddApplicationSheet } = load(source("features/applications/add-sheet.tsx"), {
	"@reactive-resume/utils/timezone": timezoneHelpers,
	"@/features/application-detail/hooks": { useUserTime: () => ({ timeZone: "UTC" }) },
	"@orpc/client": { ORPCError },
	"@tanstack/react-query": {
		useQuery: (options) =>
			options.queryKey[0] === "posting-match" && duplicateLookupError
				? duplicateObserver.getCurrentResult()
				: { data: options.queryKey[0] === "posting-match" ? null : [], isPending: false, isError: false },
	},
	"expo-router": { useRouter: () => ({ push() {} }) },
	"./date": { parseDateOnly: () => new Date() },
	"./error": { applicationError },
	"./lane-notice": { LaneNotice: "LaneNotice" },
	"./lane-queries": { useApplicationLanes: () => ({ lanes, active: lanes, ready: true, supported: true }) },
	"./lanes": {
		getLaneLabel: (l) => l.label,
		laneInput: () => ({ status: "saved", laneId: "saved" }),
		resolveLane: () => lanes[0],
	},
	"./prior-no-response": { PriorNoResponse: "PriorNoResponse" },
	"./queries": {
		useApplicationMutations: () => ({
			create: {
				mutateAsync: async (input) => {
					saved = input;
					return "job";
				},
			},
			update: {},
		}),
	},
	"./stages": { CLOSED_REASONS: [], getClosedReasonLabel: String },
	"@/api/client": {
		client: {
			applications: {
				ai: {
					parsePosting: async (input) => {
						await authorizeAiRequest(["applications", "ai", "parsePosting"], input, consentApi, scope);
						parseRequests.push(input);
						return {
							company: "Fictional",
							role: "Engineer",
							location: "",
							salary: "",
							sourceUrl: input.input,
							jobDescription: "Visible posting",
							postingSource: { method: "fetch", format: "text", truncated: false, completeness: "unknown" },
						};
					},
				},
			},
		},
		orpc: {
			applications: { findPosting: { queryOptions: () => ({ queryKey: ["posting-match"] }) } },
			documents: { list: { queryOptions: () => ({ queryKey: [] }) } },
			webAccess: { status: { queryOptions: () => ({ queryKey: [] }) } },
		},
	},
	"@/auth/session": auth,
	"@/features/ai/providers": {
		AIProviderSetupSheet: "AIProviderSetupSheet",
		useHasAIProvider: () => ({ hasAIProvider: hasProvider }),
	},
	"@/features/ai/web-access": { WebAccessAttention: "WebAccessAttention" },
	"@/features/application-detail/date-field": { WallClockField: "WallClockField" },
	"@/routes": { routes: { applicationDetails: (id) => `/applications/${id}` } },
	"@/ui": ui,
});
const props = { initialCapture: incoming, onClose() {} };
const view = () => render(AddApplicationSheet, props);
tree = view();
assert.ok(
	nodes(tree).some((n) => /Description is clipped/.test(n.props.message ?? "")),
	"clipping warning visible before More details",
);
control(tree, "Company").onChangeText("Fictional Co");
control(view(), "Role / title").onChangeText("Engineer");
control(nodes(view()).find((node) => node.type === "EditorSheet").props.footer, "Save job").onPress();
await settle();
assert.equal(saved.jobDescription.length, 20_000);
assert.equal(saved.postingSource.truncated, true);
assert.equal(saved.postingSource.completeness, "incomplete");
assert.equal(saved.status, "saved");
duplicateLookupError = true;
const duplicateClient = new QueryClient();
duplicateObserver = new QueryObserver(duplicateClient, {
	queryKey: ["posting-match"],
	queryFn: async () => {
		throw new ORPCError("NOT_FOUND");
	},
	retry: false,
});
const unsubscribeDuplicate = duplicateObserver.subscribe(() => {});
assert.equal(
	control(nodes(view()).find((node) => node.type === "EditorSheet").props.footer, "Save job").disabled,
	true,
	"Save waits while the actual QueryClient lookup is pending",
);
await duplicateObserver.refetch();
assert.equal(duplicateObserver.getCurrentResult().error.code, "NOT_FOUND");
assert.equal(duplicateObserver.getCurrentResult().isPending, false);
saved = undefined;
tree = view();
assert.ok(nodes(tree).some((n) => /Duplicate check unavailable/.test(n.props.message ?? "")));
const legacySave = control(nodes(tree).find((node) => node.type === "EditorSheet").props.footer, "Save job");
assert.equal(!!legacySave.disabled, false, "a missing lookup on an older server must not block saving");
legacySave.onPress();
await settle();
assert.equal(saved.sourceUrl, incoming.url);
unsubscribeDuplicate();
duplicateClient.clear();
reset();
let pasteTree = render(AddApplicationSheet, { onClose() {} });
nodes(pasteTree)
	.find((node) => node.type === "Segmented")
	.props.onChange("text");
pasteTree = render(AddApplicationSheet, { onClose() {} });
assert.equal(
	nodes(pasteTree).some((node) => node.props.label === "Read posting"),
	false,
	"non-AI reading applies only to links",
);
reset();
const supportedForm = () => render(AddApplicationSheet, { onClose() {} });
control(supportedForm(), "Job posting link").onChangeText("https://jobs.example.test/role");
control(supportedForm(), "Read posting").onPress();
await settle();
assert.equal(parseRequests.at(-1).useAI, false, "Supported server receives explicit no-AI flag");
for (const failure of [new ORPCError("NOT_FOUND"), new TypeError("Private connection diagnostic")]) {
	reset();
	supportFailure = failure;
	const before = parseRequests.length;
	control(supportedForm(), "Job posting link").onChangeText("https://jobs.example.test/role");
	control(supportedForm(), "Read posting").onPress();
	await settle();
	assert.equal(parseRequests.length, before, "Unknown or failed support must never parse");
	assert.ok(
		nodes(supportedForm()).some(
			(n) =>
				n.props.message ===
				"Reading without AI couldn't be confirmed. Retry, update your server, or enter the details manually.",
		),
		"Shipped form and error mapper must show compatibility guidance",
	);
}
supportFailure = undefined;
assert.equal(
	applicationError(new Error("Private diagnostic")),
	"Couldn't complete the request. Check your connection and try again.",
	"Arbitrary error text remains hidden",
);
reset();
render(IncomingPosting, {});
payloads = [{ shareType: "text", value: "Pending" }];
foreground.forEach((f) => f("active"));
assert.ok(render(IncomingPosting, {}));
identity.forEach((f) => f());
scope = "bob";
sessions.forEach((f) => f());
assert.equal(render(IncomingPosting, {}), null, "identity change clears active and native pending text");
session = { ...session, status: "signed-out" };
scope = null;
sessions.forEach((f) => f());
assert.equal(currentNativeScope, null, "disconnect clears private group context");
reset();
console.log(
	"PASS real native raw receiver → form truncation warning/metadata, one-shot activation, account/disconnect privacy; no AI/save before explicit action",
);
