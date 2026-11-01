import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import {
	getAccountGeneration,
	getAccountId,
	invalidateAccountScope,
	registerAccountReset,
	setAccountScope,
} from "./auth/account-scope";
import { loadRootContext, sessionQueryKey } from "./root-context";

const getSessionMock = vi.hoisted(() => vi.fn());
const flagsGetMock = vi.hoisted(() => vi.fn().mockResolvedValue({ disableSignups: false, disableEmailAuth: false }));
const loadLocaleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("./auth/session", () => ({
	getSession: getSessionMock,
}));

vi.mock("./locale", () => ({
	getLocale: () => "en-US",
	loadLocale: loadLocaleMock,
}));

vi.mock("./orpc/client", () => ({
	client: {
		flags: {
			get: flagsGetMock,
		},
	},
}));

vi.mock("./theme", () => ({
	getTheme: () => "system",
}));

describe("loadRootContext", () => {
	beforeEach(() => {
		invalidateAccountScope();
		registerAccountReset(() => undefined);
		loadLocaleMock.mockResolvedValue(undefined);
	});

	it("loads root context with freshly fetched session", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const mockSession = {
			user: { id: "user-1", name: "Alice" },
			session: { id: "sess-1" },
		};
		getSessionMock.mockResolvedValueOnce(mockSession);

		const context = await loadRootContext(queryClient);
		expect(context.session).toEqual(mockSession);
	});

	it("retains cached session when getSession encounters a transient error on refresh", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const cachedSession = {
			user: { id: "user-1", name: "Alice" },
			session: { id: "sess-1" },
		};
		queryClient.setQueryData(sessionQueryKey, cachedSession);
		// Mark stale/invalid so getSession is invoked
		void queryClient.invalidateQueries({ queryKey: sessionQueryKey });

		getSessionMock.mockRejectedValueOnce(new Error("Too many requests. Please try again later."));

		const context = await loadRootContext(queryClient);
		expect(context.session).toEqual(cachedSession);
	});

	it("re-throws error when getSession fails and there is no cached session", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		getSessionMock.mockRejectedValueOnce(new Error("Session check failed with status 500"));

		await expect(loadRootContext(queryClient)).rejects.toThrow("Session check failed with status 500");
	});

	it("does not let a preload certify an account for the page that is on screen", async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		setAccountScope("alice");
		const generation = getAccountGeneration();
		getSessionMock.mockResolvedValueOnce({ user: { id: "bob" }, session: { id: "bob-session" } });

		await loadRootContext(queryClient, { commit: false });

		expect(getAccountId()).toBe("alice");
		expect(getAccountGeneration()).toBe(generation);
	});

	it("drops the previous account's cached data before certifying a committed account change", async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		setAccountScope("alice");
		queryClient.setQueryData(["career", "profile"], { targetRoles: ["Alice private role"] });
		registerAccountReset(() => queryClient.clear());
		getSessionMock.mockResolvedValueOnce({ user: { id: "bob" }, session: { id: "bob-session" } });

		await loadRootContext(queryClient, { commit: true });

		expect(getAccountId()).toBe("bob");
		expect(queryClient.getQueryData(["career", "profile"])).toBeUndefined();
	});

	it("lets a pending committed load certify its account after a later hover preload", async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		setAccountScope("alice");
		queryClient.setQueryData(["career", "profile"], { targetRoles: ["Alice private role"] });
		registerAccountReset(() => queryClient.clear());
		getSessionMock.mockResolvedValueOnce({ user: { id: "bob" }, session: { id: "bob-session" } });
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		loadLocaleMock.mockReturnValueOnce(barrier);
		const committed = loadRootContext(queryClient, { commit: true });
		await loadRootContext(queryClient, { commit: false });
		expect(getAccountId()).toBe("alice");
		release();
		await committed;
		expect(getAccountId()).toBe("bob");
		expect(queryClient.getQueryData(["career", "profile"])).toBeUndefined();
	});

	it("ignores a stale root load that finishes after a newer one certified the account", async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		let release!: () => void;
		const barrier = new Promise<void>((resolve) => {
			release = resolve;
		});
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		loadLocaleMock.mockImplementationOnce(() => {
			started();
			return barrier;
		});
		queryClient.setQueryData(sessionQueryKey, { user: { id: "alice" }, session: { id: "alice-session" } });
		const stale = loadRootContext(queryClient);
		await ready;
		queryClient.setQueryData(sessionQueryKey, { user: { id: "bob" }, session: { id: "bob-session" } });
		const fresh = await loadRootContext(queryClient);
		const afterNew = { id: getAccountId(), generation: getAccountGeneration() };
		expect(afterNew.id).toBe("bob");
		expect(fresh.session).toMatchObject({ user: { id: "bob" } });

		release();
		await stale;

		expect({ id: getAccountId(), generation: getAccountGeneration() }).toEqual(afterNew);
	});
});
