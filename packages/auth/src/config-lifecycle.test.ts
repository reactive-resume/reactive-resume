import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ betterAuth: vi.fn() }));

vi.mock("better-auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth")>()),
	betterAuth: mocks.betterAuth,
}));
vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("@reactive-resume/email/transport", () => ({ sendEmail: vi.fn() }));
vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "http://localhost:3000", AUTH_SECRET: "auth-lifecycle-test" },
}));

function createInstance(context = Promise.resolve({})) {
	return {
		$context: context,
		api: { getSession: vi.fn().mockResolvedValue(null) },
		handler: vi.fn().mockResolvedValue(new Response("ok")),
	};
}

function duplicateResourceError() {
	return new Error("Failed query: insert into oauth_resource", {
		cause: Object.assign(new Error("duplicate key violates unique constraint"), { code: "23505" }),
	});
}

beforeEach(() => {
	vi.resetModules();
	mocks.betterAuth.mockReset();
});

describe("auth initialization lifecycle", () => {
	it("does not construct auth during module import", async () => {
		await import("./config");
		expect(mocks.betterAuth).not.toHaveBeenCalled();
	});

	it("shares one pending initialization across callers and preserves the auth API", async () => {
		const pending = Promise.withResolvers<object>();
		const instance = createInstance(pending.promise);
		mocks.betterAuth.mockReturnValue(instance);
		const { auth, initializeAuth } = await import("./config");

		const first = initializeAuth();
		const second = initializeAuth();
		expect(auth.api).toBe(instance.api);
		expect(auth.handler).toBe(instance.handler);
		expect(auth.$context).toBe(pending.promise);
		expect(mocks.betterAuth).toHaveBeenCalledTimes(1);

		pending.resolve({});
		await Promise.all([first, second]);
		await initializeAuth();
		expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
	});

	it("propagates transient initialization failure and rebuilds on the next call", async () => {
		const failure = new Error("Connection terminated due to connection timeout");
		const recovered = createInstance();
		mocks.betterAuth.mockImplementationOnce(() => createInstance(Promise.reject(failure))).mockReturnValue(recovered);
		const { auth, initializeAuth } = await import("./config");

		await expect(initializeAuth()).rejects.toBe(failure);
		expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
		await initializeAuth();
		expect(auth.api).toBe(recovered.api);
		expect(mocks.betterAuth).toHaveBeenCalledTimes(2);
	});

	it("does not reset successful initialization or replay a failing endpoint", async () => {
		const instance = createInstance();
		const failure = new Error("Endpoint failure");
		instance.api.getSession.mockRejectedValueOnce(failure);
		mocks.betterAuth.mockReturnValue(instance);
		const { auth, initializeAuth } = await import("./config");
		await initializeAuth();

		await expect(auth.api.getSession({ headers: new Headers() })).rejects.toBe(failure);
		await initializeAuth();
		expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
		expect(instance.api.getSession).toHaveBeenCalledTimes(1);
		expect(auth.api).toBe(instance.api);
	});

	it("retries nested PostgreSQL resource conflicts up to all four audiences", async () => {
		const recovered = createInstance();
		for (let index = 0; index < 4; index++) {
			mocks.betterAuth.mockImplementationOnce(() => createInstance(Promise.reject(duplicateResourceError())));
		}
		mocks.betterAuth.mockReturnValue(recovered);
		const { auth, initializeAuth } = await import("./config");

		await initializeAuth();
		expect(mocks.betterAuth).toHaveBeenCalledTimes(5);
		expect(auth.api).toBe(recovered.api);
	});

	it("stops retrying after the resource-conflict budget is exhausted", async () => {
		const failure = duplicateResourceError();
		mocks.betterAuth.mockImplementation(() => createInstance(Promise.reject(failure)));
		const { initializeAuth } = await import("./config");

		await expect(initializeAuth()).rejects.toBe(failure);
		expect(mocks.betterAuth).toHaveBeenCalledTimes(5);
	});

	it("does not retry other PostgreSQL errors or errors mentioning duplicate without its code", async () => {
		const { initializeAuth } = await import("./config");
		const failures = [new Error("Failed query", { cause: { code: "08006" } }), new Error("duplicate request")];
		for (const failure of failures) {
			mocks.betterAuth.mockImplementationOnce(() => createInstance(Promise.reject(failure)));
			await expect(initializeAuth()).rejects.toBe(failure);
		}
		expect(mocks.betterAuth).toHaveBeenCalledTimes(failures.length);
	});
});
