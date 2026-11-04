// The native Coach's web search gate (provider.tsx useWebSearch); queries are host substitutes, not device execution.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bundle, load, tag } from "./harness.mjs";

const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
let webStatus;
let nativeCapability;
const mocks = {
	"@reactive-resume/ai/types": bundle("../../../packages/ai/src/types.ts"),
	"@lingui/react/macro": {
		useLingui: () => ({ t: tag }),
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
const { useWebSearch } = load("../src/features/assistant/provider.tsx", mocks, {
	jsx: "transform",
	globals: { React: react },
});

test("native Coach retains approved fallback after auth/quota failure, without enabling unsupported destinations", () => {
	for (const [search, failure, provider, capability, expected] of [
		[true, undefined, undefined, undefined, true],
		[false, "auth", { provider: "openai" }, 1, true],
		[false, "quota", { provider: "anthropic" }, 1, true],
		[false, "auth", { provider: "openai-compatible" }, 1, false],
		[false, "auth", { provider: "openai" }, undefined, false],
		[false, "auth", undefined, 1, false],
		[false, "rate-limit", { provider: "openai" }, 1, false],
		[false, undefined, { provider: "openai" }, 1, false],
	]) {
		webStatus = { search, testResult: { search: { error: failure } } };
		nativeCapability = { nativeWebSearch: capability };
		assert.equal(useWebSearch(provider).canSearch, expected, JSON.stringify({ search, failure, provider, capability }));
	}
});
