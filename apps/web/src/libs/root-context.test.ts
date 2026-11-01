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

const localeMock = vi.hoisted(() => vi.fn().mockReturnValue("en-US"));
const loadLocaleMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const updateProfileMock = vi.hoisted(() => vi.fn().mockResolvedValue({ status: true }));

vi.mock("./auth/session", () => ({
	getSession: getSessionMock,
}));

vi.mock("./locale", () => ({
	getLocale: localeMock,
	loadLocale: loadLocaleMock,
}));

vi.mock("./orpc/client", () => ({
	client: {
		auth: { updateProfile: updateProfileMock },
		flags: {
			get: flagsGetMock,
		},
	},
}));

vi.mock("./theme", () => ({
	getTheme: () => "system",
}));

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe("loadRootContext", () => {
	beforeEach(() => {
		invalidateAccountScope();
		registerAccountReset(() => undefined);
		loadLocaleMock.mockResolvedValue(undefined);
		localeMock.mockReturnValue("en-US");
		updateProfileMock.mockClear();
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
		expect(updateProfileMock).not.toHaveBeenCalled();
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

	it("saves the interface language once for the current account session", async () => {
		// Reset once for this scenario; navigations and account replacements share the same module.
		vi.resetModules();
		const fresh = await import("./root-context");
		updateProfileMock.mockClear();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		getSessionMock.mockResolvedValue({ user: { id: "user-1", locale: "ar-SA" }, session: { id: "sess-1" } });

		await fresh.loadRootContext(queryClient);
		void queryClient.invalidateQueries({ queryKey: fresh.sessionQueryKey });
		await fresh.loadRootContext(queryClient);

		expect(updateProfileMock).toHaveBeenCalledTimes(1);
		expect(updateProfileMock).toHaveBeenCalledWith({ locale: "en-US" }, { context: { accountId: "user-1" } });
	});
	it("synchronizes an account replacement without a page reload", async () => {
		vi.resetModules();
		const fresh = await import("./root-context");
		updateProfileMock.mockClear();
		const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		getSessionMock.mockResolvedValue({ user: { id: "first", locale: "en-US" }, session: { id: "first-session" } });
		await fresh.loadRootContext(cache);
		cache.removeQueries({ queryKey: fresh.sessionQueryKey });
		getSessionMock.mockResolvedValue({ user: { id: "second", locale: "ar-SA" }, session: { id: "second-session" } });
		await fresh.loadRootContext(cache);
		expect(updateProfileMock).toHaveBeenCalledExactlyOnceWith(
			{ locale: "en-US" },
			{ context: { accountId: "second" } },
		);
	});

	it.each(["rejected", "returned"])("retries a %s locale update on a later navigation", async (failure) => {
		vi.resetModules();
		const fresh = await import("./root-context");
		updateProfileMock.mockClear();
		if (failure === "rejected") updateProfileMock.mockRejectedValueOnce(new Error("Offline"));
		else updateProfileMock.mockResolvedValueOnce({ status: false });
		getSessionMock.mockResolvedValue({ user: { id: "retry", locale: "ar-SA" }, session: { id: "retry-session" } });
		const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		await fresh.loadRootContext(cache);
		await Promise.resolve();
		await fresh.loadRootContext(cache);
		expect(updateProfileMock).toHaveBeenCalledTimes(2);
	});

	it("does not send an old account's locale update after the session changes during root loading", async () => {
		vi.resetModules();
		const fresh = await import("./root-context");
		updateProfileMock.mockClear();
		const waiting = deferred<void>();
		loadLocaleMock.mockReturnValueOnce(waiting.promise);
		const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const first = { user: { id: "first", locale: "ar-SA" }, session: { id: "first-session" } };
		cache.setQueryData(fresh.sessionQueryKey, first);
		const loading = fresh.loadRootContext(cache);
		cache.setQueryData(fresh.sessionQueryKey, {
			user: { id: "second", locale: "ar-SA" },
			session: { id: "second-session" },
		});
		waiting.resolve();
		await loading;
		expect(updateProfileMock).not.toHaveBeenCalled();
	});

	it("ignores an old completion after A to B to A while deduplicating the current check", async () => {
		vi.resetModules();
		const fresh = await import("./root-context");
		const old = deferred<{ status: boolean }>();
		const current = deferred<{ status: boolean }>();
		updateProfileMock.mockClear();
		updateProfileMock.mockReturnValueOnce(old.promise);
		updateProfileMock.mockResolvedValueOnce({ status: true });
		updateProfileMock.mockReturnValueOnce(current.promise);
		const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		for (const id of ["A", "B", "A"]) {
			cache.removeQueries({ queryKey: fresh.sessionQueryKey });
			getSessionMock.mockResolvedValue({ user: { id, locale: "ar-SA" }, session: { id: `${id}-session` } });
			await fresh.loadRootContext(cache);
		}
		expect(updateProfileMock).toHaveBeenCalledTimes(3);
		old.resolve({ status: false });
		await Promise.resolve();
		await fresh.loadRootContext(cache);
		expect(updateProfileMock).toHaveBeenCalledTimes(3);
		current.resolve({ status: true });
	});
});
