// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient } from "@tanstack/react-query";
import { prepareRequest } from "@reactive-resume/utils/deferred-request";
import { deleteConversation } from "./coach-thread";
import { pendingCommits } from "./pending-commits";
import { setAccountScope } from "@/libs/auth/account-scope";

const env = vi.hoisted(() => ({
	rows: [{ id: "fictional-thread" }],
	deleted: vi.fn(),
	notices: [] as { actionProps: { onClick: () => void } }[],
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: {
		add: (notice: (typeof env.notices)[number]) => {
			env.notices.push(notice);
			return env.notices.length;
		},
		close: vi.fn(),
	},
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: { agent: { threads: { list: { key: () => ["threads"], queryKey: () => ["threads"] } } } },
	client: { agent: { threads: { delete: env.deleted } } },
	prepareRpc: (procedure: () => Promise<unknown>) =>
		prepareRequest((defer) =>
			defer(async () => {
				await procedure();
				return new Response();
			}),
		),
}));
const clients: QueryClient[] = [];
beforeEach(() => {
	setAccountScope("alice");
	i18n.load("en", {});
	i18n.activate("en");
	env.rows = [{ id: "fictional-thread" }];
	env.notices.length = 0;
	env.deleted.mockReset().mockImplementation(async () => {
		env.rows = [];
	});
});
afterEach(() => {
	clients.forEach((client) => client.clear());
	clients.length = 0;
	pendingCommits.clear();
});
async function scenario() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(queryClient);
	await queryClient.fetchQuery({ queryKey: ["threads"], queryFn: async () => env.rows });
	const hide = vi.fn();
	const restore = vi.fn();
	deleteConversation(queryClient, "fictional-thread", hide, restore);
	expect(hide).toHaveBeenCalledOnce();
	await vi.waitFor(() => expect(env.notices).toHaveLength(1));
	return { queryClient, restore };
}
it("committed conversation deletion refreshes the list without reopening the deleted thread", async () => {
	const h = await scenario();
	for (const flush of pendingCommits) flush();
	await vi.waitFor(() => expect(h.queryClient.getQueryData(["threads"])).toEqual([]));
	expect(env.deleted).toHaveBeenCalledOnce();
	expect(h.restore).not.toHaveBeenCalled();
});
for (const erasedElsewhere of [false, true])
	it(`Undo reopens only a canonical surviving conversation (erased=${erasedElsewhere})`, async () => {
		const h = await scenario();
		if (erasedElsewhere) env.rows = [];
		const notice = env.notices.at(0);
		if (!notice) throw new Error("Missing Undo notice");
		notice.actionProps.onClick();
		await vi.waitFor(() => expect(h.queryClient.getQueryState(["threads"])?.fetchStatus).toBe("idle"));
		if (erasedElsewhere) {
			await vi.waitFor(() => expect(h.queryClient.getQueryData(["threads"])).toEqual([]));
			expect(h.restore).not.toHaveBeenCalled();
		} else await vi.waitFor(() => expect(h.restore).toHaveBeenCalledOnce());
		expect(env.deleted).not.toHaveBeenCalled();
	});
