import assert from "node:assert/strict";
import { test } from "node:test";
import { bundle, mobileRequire } from "./harness.mjs";
const { QueryClient } = mobileRequire("@tanstack/react-query");
const load = (deps) => bundle("../src/features/assistant/chat.ts", deps);
test("native finished or failed web replies refresh status only for their own account", () => {
	const client = new QueryClient();
	let account = "server/account-a";
	const key = ["web-access"];
	const deps = {
		react: { useMemo: (f) => f(), useRef: (value) => ({ current: value }), useLayoutEffect: (f) => f() },
		"@ai-sdk/react": {
			Chat: class {
				constructor(options) {
					this.options = options;
				}
			},
			useChat: () => ({}),
		},
		"@lingui/core": { i18n: {} },
		"@lingui/core/macro": { ph: (value) => value, t: (parts) => parts.join("") },
		"@orpc/client": { ORPCError: class extends Error {} },
		"@tanstack/react-query": { useQueryClient: () => client, useQuery: () => ({}) },
		ai: {
			lastAssistantMessageIsCompleteWithApprovalResponses: () => false,
			lastAssistantMessageIsCompleteWithToolCalls: () => false,
		},
		"@reactive-resume/ai/tools/transcript": { transcriptOf: () => "" },
		"./transport": {},
		"@/api/client": { orpc: { webAccess: { status: { key: () => key } } }, streamClient: { agent: { messages: {} } } },
		"@/auth/session": { getAccountScope: () => account, useSession: () => ({}) },
	};
	const { useAssistantChat } = load(deps);
	const { instance } = useAssistantChat({
		threadId: "thread-a",
		initialMessages: [],
		context: { document: false, posting: false },
		scope: account,
		onFinish: () => {},
	});
	for (const event of ["onFinish", "onError"]) {
		client.setQueryData(key, { search: true });
		instance.options[event]();
		assert.equal(client.getQueryState(key).isInvalidated, true, event);
		client.setQueryData(key, { search: true });
		account = "server/account-b";
		instance.options[event]();
		assert.equal(client.getQueryState(key).isInvalidated, false, "old account cannot refresh new account status");
		account = "server/account-a";
	}
	client.clear();
});
