// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
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
	const state = { canonical: [{ text: "Fictional private fact" }], offline: false, hidden: false, sent: 0 };
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
		hide: () => {
			state.hidden = true;
		},
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
	window.dispatchEvent(new Event("pagehide"));
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
	// Let every continuation of the pending read settle, not just the next microtask or two.
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(h.state.hidden).toBe(true);
	expect(h.state.sent).toBe(0);
});

it("does not hide a row or acknowledge Undo until its transport is ready", async () => {
	const client = new QueryClient();
	clients.push(client);
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	let hidden = false;
	const preparing = prepareRequest(async (defer) => {
		await wait;
		return defer(() => Promise.resolve(new Response()));
	});
	withQueryUndo({
		queryClient: client,
		queryKey: ["facts"],
		description: "Fact forgotten",
		errorMessage: "Try again",
		prepare: () => preparing,
		hide: () => {
			hidden = true;
		},
		restore: () => {
			hidden = false;
		},
	});
	expect(hidden).toBe(false);
	expect(notices).toHaveLength(0);
	release();
	await preparing;
	expect(hidden).toBe(true);
	expect(notices).toHaveLength(1);
});

it("prepared deletion refreshes dependent application state without unrelated failures blocking canonical reveal", async () => {
	const h = await scenario();
	const applicationKey = ["applications", "detail", "fictional-job"];
	const reportKey = ["reports"];
	h.client.setQueryData(applicationKey, { followUp: "old schedule" });
	h.client.setQueryData(reportKey, { count: 1 });
	h.client.setQueryData(["auth"], { id: "alice" });
	h.client.setQueryData(["flags"], {});
	const applicationObserver = new QueryObserver(h.client, {
		queryKey: applicationKey,
		queryFn: async () => ({ followUp: null }),
		staleTime: Infinity,
	});
	let reportReads = 0;
	const reportObserver = new QueryObserver(h.client, {
		queryKey: reportKey,
		queryFn: async () => {
			reportReads++;
			throw new Error("Unrelated report unavailable");
		},
		staleTime: Infinity,
	});
	const unsubscribeApplication = applicationObserver.subscribe(() => {});
	const unsubscribeReport = reportObserver.subscribe(() => {});
	try {
		h.state.canonical = [];
		notice(0).onClose?.();
		await vi.waitFor(() => expect(h.state.hidden).toBe(false));
		expect(h.client.getQueryData(h.key)).toEqual([]);
		await vi.waitFor(() => expect(h.client.getQueryData(applicationKey)).toEqual({ followUp: null }));
		expect(reportReads).toBe(1);
		expect(notices).toHaveLength(1);
		expect(h.client.getQueryState(["auth"])?.isInvalidated).toBe(false);
		expect(h.client.getQueryState(["flags"])?.isInvalidated).toBe(false);
	} finally {
		unsubscribeApplication();
		unsubscribeReport();
	}
});
