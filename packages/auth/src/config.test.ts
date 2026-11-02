import { describe, expect, it } from "vite-plus/test";
import { env } from "@reactive-resume/env/server";
import { auth } from "./config";

describe("social provider signup policy", () => {
	it.each(["google", "github", "linkedin"] as const)(
		"allows implicit signup through %s while honoring the global signup restriction",
		(provider) => {
			// Better Auth 1.7 allows a lazy `() => config` form; ours are always static objects.
			const config = auth.options.socialProviders?.[provider];
			if (typeof config === "function") throw new TypeError(`${provider} provider config should be a static object`);

			expect(config).not.toHaveProperty("disableImplicitSignUp");
			expect(config?.disableSignUp).toBe(env.FLAG_DISABLE_SIGNUPS);
		},
	);
});

describe("session freshness", () => {
	it("disables the freshness gate so provider unlinking works for week-old sessions", () => {
		expect(auth.options.session?.freshAge).toBe(0);
	});
});

describe("new account timezone", () => {
	const createBefore = auth.options.databaseHooks?.user?.create?.before;

	if (!createBefore) throw new Error("Missing user create hook");

	const now = new Date();
	const newUser = {
		id: "new-user",
		email: "new-user@example.test",
		emailVerified: false,
		name: "New user",
		createdAt: now,
		updatedAt: now,
	};
	const contextWith = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as never;

	it("starts a new account in the device timezone sent by the client", async () => {
		await expect(createBefore(newUser, contextWith({ "x-client-timezone": "Europe/Berlin" }))).resolves.toEqual({
			data: expect.objectContaining({ timezone: "Europe/Berlin" }),
		});
	});

	it.each([{}, { "x-client-timezone": "Not/A_Timezone" }])(
		"keeps the database default when the header is missing or invalid",
		async (headers) => {
			await expect(createBefore(newUser, contextWith(headers))).resolves.toBeUndefined();
		},
	);

	it("starts a new account in the interface language it signed up in", async () => {
		await expect(createBefore(newUser, contextWith({ cookie: "theme=dark; locale=ar-SA" }))).resolves.toEqual({
			data: expect.objectContaining({ locale: "ar-SA" }),
		});
	});

	it.each(["locale=xx-XX", "locale=", ""])("leaves the language unknown for the cookie %j", async (cookie) => {
		await expect(createBefore(newUser, contextWith({ cookie }))).resolves.toBeUndefined();
	});

	it("gives a guest both a username and the device timezone", async () => {
		await expect(
			createBefore({ ...newUser, isAnonymous: true }, contextWith({ "x-client-timezone": "Asia/Kolkata" })),
		).resolves.toEqual({
			data: expect.objectContaining({
				timezone: "Asia/Kolkata",
				username: expect.stringMatching(/^guest-/),
				displayUsername: expect.stringMatching(/^guest-/),
			}),
		});
	});
});

it.each([
	["GET", "/reference"],
	["GET", "/token"],
	["POST", "/delete-anonymous-user"],
])("does not serve %s %s", async (method, path) => {
	const response = await auth.handler(new Request(`${env.APP_URL}/api/auth${path}`, { method }));
	expect(response.status).toBe(404);
});

it("publishes the configured native authentication HTTP contract", async () => {
	const response = await auth.handler(new Request(`${env.APP_URL}/api/auth/open-api/generate-schema`));
	expect(response.status).toBe(200);
	const spec = await response.json();
	expect(spec.paths).toHaveProperty("/sign-in/email");
	expect(spec.paths).toHaveProperty("/get-session");
	expect(spec.paths).toHaveProperty("/api-key/create");
});
