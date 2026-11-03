// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient } from "@tanstack/react-query";
import { prepareRequest } from "@reactive-resume/utils/deferred-request";
import { pendingCommits } from "./pending-commits";
import { withQueryUndo } from "./shared";
import { setAccountScope } from "@/libs/auth/account-scope";

type Notice = {
	actionProps: { children: string; onClick: () => void };
	description: string;
	onClose?: () => void;
};
const notices = vi.hoisted(() => [] as Notice[]);
vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: {
		add: (notice: Notice) => {
			notices.push(notice);
			return notices.length;
		},
		close: vi.fn(),
	},
}));
const notice = (index: number) => {
	const value = notices.at(index);
	if (!value) throw new Error("Missing notice");
	return value;
};
const clients: QueryClient[] = [];
beforeEach(() => {
	notices.length = 0;
	i18n.load("en", {});
	i18n.activate("en");
	setAccountScope("alice");
});
afterEach(() => {
	pendingCommits.clear();
	clients.forEach((client) => client.clear());
	clients.length = 0;
});

async function scenario() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	const key = ["facts"];
	const state = { canonical: [{ text: "Fictional private fact" }], offline: false, hidden: true, sent: 0 };
	await client.fetchQuery({
		queryKey: key,
		queryFn: () => {
			if (state.offline) throw new Error("offline");
			return state.canonical;
		},
	});
	const preparing = prepareRequest((defer) =>
		defer(() => {
			state.sent++;
			return Promise.resolve(new Response());
		}),
	);
	withQueryUndo({
		queryClient: client,
		queryKey: key,
		description: "Fact forgotten",
		errorMessage: "Try again",
		prepare: () => preparing,
		restore: () => {
			state.hidden = false;
		},
	});
	await preparing;
	return { client, key, state };
}

it("Undo waits for canonical readback; failed read cannot reveal cached erased text, Retry never rewrites it", async () => {
	const h = await scenario();
	h.state.canonical = [];
	h.state.offline = true;
	notice(0).actionProps.onClick();
	await vi.waitFor(() => expect(notices).toHaveLength(2));
	expect(h.state.hidden).toBe(true);
	expect(h.client.getQueryData(h.key)).toEqual([{ text: "Fictional private fact" }]);
	expect(h.state.sent).toBe(0);
	h.state.offline = false;
	expect(notice(1).actionProps.children).toBe("Retry");
	notice(1).actionProps.onClick();
	await vi.waitFor(() => expect(h.state.hidden).toBe(false));
	expect(h.client.getQueryData(h.key)).toEqual([]);
	expect(h.state.sent).toBe(0);
});

it("prepared page-close flush enters transport synchronously once", async () => {
	const h = await scenario();
	for (const flush of pendingCommits) flush();
	expect(h.state.sent).toBe(1);
	expect(pendingCommits.size).toBe(0);
	await vi.waitFor(() => expect(h.state.hidden).toBe(false));
});

it("a departed account cannot reveal rows after a pending canonical read", async () => {
	const h = await scenario();
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	vi.spyOn(h.client, "invalidateQueries").mockImplementation(async () => {
		await wait;
	});
	notice(0).actionProps.onClick();
	await vi.waitFor(() => expect(h.client.invalidateQueries).toHaveBeenCalled());
	setAccountScope("bob");
	release();
	await wait;
	await Promise.resolve();
	expect(h.state.hidden).toBe(true);
	expect(h.state.sent).toBe(0);
});
