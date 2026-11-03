// @vitest-environment happy-dom
import type { Application, ApplicationSummary } from "./types";
import { describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { prepareRequest } from "@reactive-resume/utils/deferred-request";
import { withQueryUndo } from "@/features/career/shared";
import { setAccountScope } from "@/libs/auth/account-scope";

const undoNotices = vi.hoisted(() => [] as { type?: string; actionProps?: { onClick: () => void } }[]);
vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: { add: (notice: (typeof undoNotices)[number]) => undoNotices.push(notice), close: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
	query: (key: readonly unknown[]) => ({
		queryOptions: ({ input }: { input: unknown }) => ({ queryKey: [...key, input] }),
		queryKey: ({ input }: { input: unknown }) => [...key, input],
	}),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			listSummary: mocks.query(["applications", "summary"]),
			list: mocks.query(["applications"]),
			getById: mocks.query(["applications", "detail"]),
		},
	},
}));

import { applicationDetailQueryKey, hydrateApplicationDetail } from "./queries";

const detail = (updatedAt: string, notes: string): Application =>
	({
		id: "a",
		status: "applied",
		closedReason: null,
		updatedAt: new Date(updatedAt),
		notes,
	}) as Application;

const summary = (initialDetail: Application): ApplicationSummary =>
	({
		id: "a",
		status: "applied",
		closedReason: null,
		initialDetail,
	}) as ApplicationSummary;

describe("application detail cache hydration", () => {
	it("replaces older cache with newer server detail and refreshes it on first open", () => {
		const client = new QueryClient();
		const key = applicationDetailQueryKey("a");
		client.setQueryData(key, detail("2026-10-01T00:00:00Z", "old"));
		const current = detail("2026-10-02T00:00:00Z", "new");

		hydrateApplicationDetail(client, summary(current));
		expect(client.getQueryData<Application>(key)?.notes).toBe("new");
		expect(client.getQueryState(key)?.dataUpdatedAt).toBe(0);
	});

	it("never lets an older refreshed list overwrite newer cached detail", () => {
		const client = new QueryClient();
		const key = applicationDetailQueryKey("a");
		client.setQueryData(key, detail("2026-10-02T00:00:00Z", "new"));
		const old = detail("2026-10-01T00:00:00Z", "old");

		const updatedAt = client.getQueryState(key)?.dataUpdatedAt;
		hydrateApplicationDetail(client, summary(old));
		expect(client.getQueryData<Application>(key)?.notes).toBe("new");
		expect(client.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
	});

	it.each([
		["stage", { status: "closed" }],
		["lane within the same stage", { laneId: "take-home" }],
	])("does not hydrate a detail whose %s no longer matches optimistic list state", (_name, patch) => {
		const client = new QueryClient();
		const old = { ...detail("2026-10-01T00:00:00Z", "old"), laneId: "interview" } as Application;
		const moved = { ...summary(old), laneId: "interview", ...patch } as ApplicationSummary;

		hydrateApplicationDetail(client, moved);
		expect(client.getQueryData<Application>(applicationDetailQueryKey("a"))).toBeUndefined();
	});

	it("cancels an older in-flight response before accepting refreshed list detail", async () => {
		const client = new QueryClient();
		const key = applicationDetailQueryKey("a");
		let resolveOld!: (value: Application) => void;
		const oldFetch = client.fetchQuery({
			queryKey: key,
			queryFn: () =>
				new Promise<Application>((resolve) => {
					resolveOld = resolve;
				}),
		});
		await Promise.resolve();
		const current = detail("2026-10-02T00:00:00Z", "new");
		hydrateApplicationDetail(client, summary(current));
		resolveOld(detail("2026-10-01T00:00:00Z", "old"));
		await oldFetch.catch(() => undefined);
		expect(client.getQueryData<Application>(key)?.notes).toBe("new");
	});

	it("keeps a newer detail refresh running when an older list arrives", async () => {
		const client = new QueryClient();
		const key = applicationDetailQueryKey("a");
		client.setQueryData(key, detail("2026-10-02T00:00:00Z", "cached"));
		let resolveRefresh!: (value: Application) => void;
		const refresh = client.fetchQuery({
			queryKey: key,
			queryFn: () =>
				new Promise<Application>((resolve) => {
					resolveRefresh = resolve;
				}),
		});
		hydrateApplicationDetail(client, summary(detail("2026-10-01T00:00:00Z", "old")));
		expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");
		resolveRefresh(detail("2026-10-03T00:00:00Z", "refreshed"));
		await refresh;
		expect(client.getQueryData<Application>(key)?.notes).toBe("refreshed");
	});

	it("shows stale initial detail immediately, refreshes once, then reuses fetched cache", async () => {
		const client = new QueryClient();
		const key = applicationDetailQueryKey("a");
		const initial = detail("2026-10-01T00:00:00Z", "initial");
		hydrateApplicationDetail(client, summary(initial));
		let calls = 0;
		const observer = new QueryObserver<Application>(client, {
			queryKey: key,
			staleTime: 60_000,
			queryFn: async () => {
				calls += 1;
				return detail("2026-10-02T00:00:00Z", "refreshed");
			},
		});
		const seen: string[] = [];
		const unsubscribe = observer.subscribe((result) => {
			if (result.data) seen.push(result.data.notes ?? "");
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seen[0]).toBe("initial");
		expect(calls).toBe(1);
		expect(client.getQueryData<Application>(key)?.notes).toBe("refreshed");
		unsubscribe();
		observer.destroy();

		const second = new QueryObserver<Application>(client, {
			queryKey: key,
			staleTime: 60_000,
			queryFn: async () => {
				calls += 1;
				return detail("2026-10-03T00:00:00Z", "unexpected");
			},
		});
		second.subscribe(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toBe(1);
		second.destroy();
	});
});

it("Undo canonical read survives fresher application-list hydration without a spurious Retry", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	setAccountScope("alice");
	undoNotices.length = 0;
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const key = applicationDetailQueryKey("a");
	const old = detail("2026-10-01T00:00:00Z", "old");
	const fresh = detail("2026-10-02T00:00:00Z", "canonical");
	let releaseDetail!: (value: Application) => void;
	const detailGate = new Promise<Application>((resolve) => {
		releaseDetail = resolve;
	});
	let releaseList!: () => void;
	const listGate = new Promise<void>((resolve) => {
		releaseList = resolve;
	});
	let detailStarted = false;
	client.setQueryDefaults(key, {
		queryFn: () => {
			detailStarted = true;
			return detailGate;
		},
	});
	client.setQueryData(key, old);
	let refreshing = false;
	const listOptions = {
		queryKey: ["application-list"],
		staleTime: Infinity,
		queryFn: async () => {
			if (!refreshing) return summary(old);
			await listGate;
			// The list's real consumer hydrates refreshed embedded full detail.
			hydrateApplicationDetail(client, summary(fresh));
			return summary(fresh);
		},
	};
	await client.fetchQuery(listOptions);
	const stop = new QueryObserver(client, listOptions).subscribe(() => {});
	refreshing = true;
	let hidden = false;
	try {
		const prepared = prepareRequest((defer) => defer(() => Promise.resolve(new Response())));
		withQueryUndo({
			queryClient: client,
			queryKey: key,
			description: "Removed fictional contact",
			errorMessage: "Try again",
			prepare: () => prepared,
			hide: () => {
				hidden = true;
			},
			restore: () => {
				hidden = false;
			},
		});
		await prepared;
		const undo = undoNotices[0]?.actionProps;
		if (!undo) throw new Error("Missing Undo");
		undo.onClick();
		await vi.waitFor(() => expect(detailStarted).toBe(true));
		releaseList();
		await Promise.resolve();
		releaseDetail(fresh);
		await vi.waitFor(() => expect(hidden).toBe(false));
		expect(client.getQueryData<Application>(key)?.notes).toBe("canonical");
		expect(undoNotices.filter((notice) => notice.type === "error")).toEqual([]);
	} finally {
		releaseList();
		releaseDetail(fresh);
		stop();
		client.clear();
	}
});
