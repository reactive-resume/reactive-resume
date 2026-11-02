import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	allocateUniqueUsername: vi.fn(async () => "new-user-1"),
	betterAuth: vi.fn(),
	delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
	env: { APP_URL: "http://localhost:3000", AUTH_SECRET: "auth-lifecycle-test", FLAG_DISABLE_EMAIL_AUTH: false },
}));

vi.mock("better-auth", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth")>()),
	betterAuth: mocks.betterAuth,
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		transaction: (run: (tx: { delete: typeof mocks.delete }) => Promise<void>) =>
			run({ delete: mocks.delete, update: () => ({ set: () => ({ where: async () => undefined }) }) } as never),
	},
}));
vi.mock("better-auth/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth/api")>()),
	createAuthMiddleware: (handler: unknown) => handler,
}));
vi.mock("./oauth-profile", async (importOriginal) => ({
	...(await importOriginal<typeof import("./oauth-profile")>()),
	allocateUniqueUsername: mocks.allocateUniqueUsername,
	isUsernameReserved: vi.fn(async () => false),
}));
vi.mock("@reactive-resume/email/transport", () => ({ sendEmail: vi.fn() }));
vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));

function createInstance(context = Promise.resolve({})) {
	return {
		$context: context,
		api: { getSession: vi.fn().mockResolvedValue(null) },
		handler: vi.fn().mockResolvedValue(new Response("ok")),
	};
}

beforeEach(() => {
	vi.resetModules();
	mocks.betterAuth.mockReset();
	mocks.delete.mockClear();
	mocks.env.FLAG_DISABLE_EMAIL_AUTH = false;
});

async function securityHooks() {
	const instance = createInstance();
	mocks.betterAuth.mockReturnValue(instance);
	await (await import("./config")).initializeAuth();
	const options = mocks.betterAuth.mock.calls[0]?.[0] as {
		hooks: {
			before: (ctx: {
				path: string;
				request?: Request;
				headers?: Headers;
				body?: Record<string, unknown>;
			}) => Promise<void>;
		};
		emailAndPassword: { onPasswordReset: (input: { user: { id: string; emailVerified: boolean } }) => Promise<void> };
	};
	return { instance, options };
}

describe("credential enrollment and recovery", () => {
	it("blocks username password sign-in when password auth is disabled", async () => {
		mocks.env.FLAG_DISABLE_EMAIL_AUTH = true;
		const { options } = await securityHooks();
		await expect(options.hooks.before({ path: "/sign-in/username" })).rejects.toMatchObject({ status: "FORBIDDEN" });
	});
	it.each(["/passkey/generate-register-options", "/passkey/verify-registration", "/api-key/create"])(
		"requires a recent session for HTTP %s",
		async (path) => {
			const { instance, options } = await securityHooks();
			const ctx = { path, request: new Request(`http://localhost:3000/api/auth${path}`) };
			instance.api.getSession.mockResolvedValue({
				user: { emailVerified: true },
				session: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
			} as never);
			await expect(options.hooks.before(ctx)).rejects.toMatchObject({ status: "FORBIDDEN" });
			instance.api.getSession.mockResolvedValue({
				user: { emailVerified: true },
				session: { createdAt: new Date() },
			} as never);
			await expect(options.hooks.before(ctx)).resolves.toBeUndefined();
		},
	);
	it("requires mailbox verification before passkey enrollment", async () => {
		const { instance, options } = await securityHooks();
		instance.api.getSession.mockResolvedValue({
			user: { emailVerified: false },
			session: { createdAt: new Date() },
		} as never);
		await expect(options.hooks.before({ path: "/passkey/verify-registration" })).rejects.toMatchObject({
			status: "FORBIDDEN",
		});
	});
	it.each([false, true])("revokes historical passkeys on password recovery with verified=%s", async (emailVerified) => {
		const { options } = await securityHooks();
		await options.emailAndPassword.onPasswordReset({ user: { id: "owner", emailVerified } });
		const schema = await import("@reactive-resume/db/schema");
		expect(mocks.delete).toHaveBeenCalledWith(schema.passkey);
	});
});

describe("auth initialization lifecycle", () => {
	it("does not construct auth during module import", async () => {
		await import("./config");
		expect(mocks.betterAuth).not.toHaveBeenCalled();
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
});

describe("email sign-up username", () => {
	it("makes one from the email address when the person leaves it empty", async () => {
		const { options } = await securityHooks();
		const body: Record<string, unknown> = { email: "new-user@example.test", username: "", displayUsername: "" };
		await options.hooks.before({ path: "/sign-up/email", body });
		expect(mocks.allocateUniqueUsername).toHaveBeenCalledWith("new-user@example.test");
		expect(body).toMatchObject({ username: "new-user-1", displayUsername: "new-user-1" });
	});
	it("keeps a username the person chose", async () => {
		mocks.allocateUniqueUsername.mockClear();
		const { options } = await securityHooks();
		const body: Record<string, unknown> = { email: "new-user@example.test", username: "chosen" };
		await options.hooks.before({ path: "/sign-up/email", body });
		expect(mocks.allocateUniqueUsername).not.toHaveBeenCalled();
		expect(body.username).toBe("chosen");
	});
});
