// Render the native model control's presentation boundary; not device execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
let webStatus;
let nativeCapability;
const aiTypes = { exports: {} };
new Function(
	"module",
	"exports",
	buildSync({
		entryPoints: [new URL("../../../packages/ai/src/types.ts", import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text,
)(aiTypes, aiTypes.exports);
const mocks = {
	"@reactive-resume/ai/types": aiTypes.exports,
	"@lingui/react/macro": {
		useLingui: () => ({ t: (parts, ...values) => parts.reduce((s, part, i) => s + part + (values[i] ?? ""), "") }),
	},
	"@reactive-resume/ai/task-models": {
		aiModelForTask: (provider, task) =>
			(task === "capable" ? provider.capableModel : provider.fastModel) ?? provider.model,
	},
	"@orpc/client": {},
	"@tanstack/react-query": {
		useQuery: ({ queryKey }) => ({ data: queryKey[0] === "web" ? webStatus : nativeCapability }),
	},
	"expo-router": {},
	react,
	"react-native": { Pressable: "Pressable" },
	"./chat": {},
	"./chat-view": {},
	"@/api/client": {
		orpc: {
			webAccess: { status: { queryOptions: () => ({ queryKey: ["web"] }), key: () => ["web"] } },
			ai: { capabilities: { queryOptions: () => ({ queryKey: ["capabilities"] }) } },
		},
	},
	"@/auth/session": { useSession: () => ({ status: "signed-in", server: "https://fictional.example.test" }) },
	"@/features/ai/providers": {},
	"@/features/ai/web-access": {},
	"@/routes": {},
	"@/ui": { Text: "Text", Icon: "Icon", useTheme: () => ({ colors: {}, space: {} }) },
};
const module = { exports: {} };
new Function(
	"React",
	"require",
	"module",
	"exports",
	transformSync(readFileSync(new URL("../src/features/assistant/provider.tsx", import.meta.url), "utf8"), {
		loader: "tsx",
		format: "cjs",
		jsx: "transform",
	}).code,
)(
	react,
	(name) => {
		assert.ok(name in mocks, `Unmapped native boundary ${name}`);
		return mocks[name];
	},
	module,
	module.exports,
);
const { ModelButton, useWebSearch } = module.exports;

test("native chat model control names the selected connection and model, retaining a missing-connection fallback", () => {
	for (const [current, expected] of [
		[{ label: "Fictional Cedar AI", model: "test-model" }, "Fictional Cedar AI · test-model"],
		[
			{ label: "Fictional Cedar AI", model: "test-model", capableModel: "capable-model" },
			"Fictional Cedar AI · capable-model",
		],
		[undefined, "Removed connection"],
	]) {
		let opens = 0;
		const control = ModelButton({ current, label: "Removed connection", onPress: () => opens++ });
		assert.deepEqual(control.props.children[0].props.children, [expected]);
		assert.equal(control.props.accessibilityLabel, `Model: ${expected}`);
		control.props.onPress();
		assert.equal(opens, 1);
	}
});

test("native Coach retains approved fallback after auth/quota failure, without enabling unsupported destinations", () => {
	for (const [search, failure, provider, capability, expected] of [
		[true, undefined, undefined, undefined, true],
		[false, "auth", { provider: "openai" }, 1, true],
		[false, "quota", { provider: "anthropic" }, 1, true],
		[false, "auth", { provider: "gemini" }, 1, true],
		[false, "auth", { provider: "openai", baseURL: "https://proxy.example.test/v1" }, 1, false],
		[false, "auth", { provider: "openai-compatible" }, 1, false],
		[false, "auth", { provider: "openai" }, undefined, false],
		[false, "auth", undefined, 1, false],
		[false, "rate-limit", { provider: "openai" }, 1, false],
		[false, "unreachable", { provider: "openai" }, 1, false],
		[false, undefined, { provider: "openai" }, 1, false],
	]) {
		webStatus = { search, testResult: { search: { error: failure } } };
		nativeCapability = { nativeWebSearch: capability };
		assert.equal(useWebSearch(provider).canSearch, expected, JSON.stringify({ search, failure, provider, capability }));
	}
});
