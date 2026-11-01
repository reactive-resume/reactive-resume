// Actual native screen and load-state owners; widgets and transport remain explicit host boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
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
const tag = (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
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
	new: () => "/new",
	newJob: () => "/applications?create=1",
	career: (p) => `/career/${p}`,
	settings: (p) => `/settings/${p ?? ""}`,
	atsChecker: () => "/ats-checker",
	trash: () => "/documents/trash",
};
const common = {
	react,
	"react-native": {
		View: "View",
		Pressable: "Pressable",
		ScrollView: "ScrollView",
		TextInput: "TextInput",
		Platform: { OS: "android" },
		BackHandler: { addEventListener: () => ({ remove() {} }) },
	},
	"expo-router": { useRouter: () => router, Stack: { Screen: "StackScreen" } },
	"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
	"@lingui/core/macro": { t: tag, plural: (value, forms) => forms.other.replace("#", String(value)) },
	"@/ui": ui,
	"@/routes": { routes },
};
function load(file, mocks = {}) {
	const module = { exports: {} };
	let source = readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
	if (process.env.RX112_MUTATION === "offer-error" && file === "features/career/offers.tsx")
		source = source.replace("applications.isError", "false");
	if (process.env.RX112_MUTATION === "letter-continuation" && file === "features/search/search-screen.tsx")
		source = source.replace("letters.length > 8", "false");
	const code = transformSync(source, {
		loader: file.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	}).code;
	const dependencies = { ...common, ...mocks };
	new Function("React", "require", "module", "exports", code)(
		react,
		(name) => {
			assert.ok(name in dependencies, "Missing boundary: " + name);
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
const shared = load("features/career/shared.tsx");
const { OffersScreen } = load("features/career/offers.tsx", {
	"./hooks": { useOffers: () => saved, useCareerQueries: () => ({ profile }) },
	"./offer-compare": load("features/career/offer-compare.ts"),
	"./offer-entry": { OfferEntry: "OfferEntry" },
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
console.log("PASS native Offers loading/error/retry/persisted row and genuine-empty controls");

let count = 9;
let failed = false;
const inputs = [];
const letters = Array.from({ length: 209 }, (_, i) => ({
	id: `letter-${i + 1}`,
	type: "letter",
	name: `Fictional letter ${i + 1}`,
	tags: ["rx112overflow"],
	updatedAt: new Date(),
	application: null,
}));
const { SearchScreen } = load("features/search/search-screen.tsx", {
	"./rank": load("features/search/rank.ts"),
	"@/auth/session": {
		getAccountScope: () => "fixture-account",
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
			if (!enabled) return state({ data: undefined, isPending: true });
			return input.type === "letter"
				? state({ data: failed ? undefined : letters.slice(0, Math.min(input.limit, count)), isError: failed })
				: state();
		},
	},
});
for (count of [8, 9, 209]) {
	reset();
	tree = render(SearchScreen);
	nodes(tree)
		.find((n) => n.type === "TextInput")
		.props.onChangeText("rx112overflow");
	render(SearchScreen);
	await new Promise((resolve) => setTimeout(resolve, 220));
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
