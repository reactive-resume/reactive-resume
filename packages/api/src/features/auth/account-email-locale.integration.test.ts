import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";

const sendEmail = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/email/transport", () => ({ sendEmail }));

// Run only against an explicitly supplied disposable database, after applying migrations.
const databaseURL = process.env.OAUTH_TEST_DATABASE_URL;

const arabic = /[؀-ۿ]/;

describe.skipIf(!databaseURL)("account emails in the account's language, with PostgreSQL", () => {
	it(
		"sends every account email in the language the account uses, wherever it is requested from",
		{ timeout: 30_000 },
		async () => {
			if (!databaseURL) return;
			process.env.DATABASE_URL = databaseURL;
			process.env.APP_URL = "http://localhost:33930";
			process.env.AUTH_SECRET = "account-email-locale-test-secret-only";
			const { auth } = await import("@reactive-resume/auth/config");
			const { db } = await import("@reactive-resume/db/client");
			const { user } = await import("@reactive-resume/db/schema");
			const { eq } = await import("drizzle-orm");
			const origin = process.env.APP_URL;
			const post = (path: string, body: object, cookie = "") =>
				auth.handler(
					new Request(`${origin}/api/auth/${path}`, {
						method: "POST",
						headers: { "content-type": "application/json", origin, cookie },
						body: JSON.stringify(body),
					}),
				);
			// Better Auth may send after it answers, so wait for the email.
			const lastEmail = async () => {
				await vi.waitFor(() => expect(sendEmail).toHaveBeenCalled());
				return sendEmail.mock.lastCall?.[0] as { to: string; subject: string; react: unknown };
			};
			const unique = randomBytes(6).toString("hex");
			const email = `layla-${unique}@example.test`;

			// Signing up in Arabic: the account keeps the language, and its verification email is in it.
			const signup = await post(
				"sign-up/email",
				{ name: "Layla Haddad", email, username: `layla-${unique}`, password: "password123" },
				"locale=ar-SA",
			);
			expect(signup.status, await signup.clone().text()).toBe(200);
			const [account] = await db.select({ locale: user.locale }).from(user).where(eq(user.email, email));
			expect(account?.locale).toBe("ar-SA");
			expect(await lastEmail()).toMatchObject({ to: email, subject: expect.stringMatching(arabic) });

			// A reset asked for from a browser in English still arrives in the account's language.
			sendEmail.mockClear();
			const reset = await post("request-password-reset", { email, redirectTo: "/auth/reset-password" }, "locale=en-US");
			expect(reset.status).toBe(200);
			expect(await lastEmail()).toMatchObject({ to: email, subject: expect.stringMatching(arabic) });

			// An unknown address answers the same and sends nothing, whatever the language.
			sendEmail.mockClear();
			const unknown = await post(
				"request-password-reset",
				{ email: `nobody-${unique}@example.test`, redirectTo: "/auth/reset-password" },
				"locale=ar-SA",
			);
			expect(unknown.status).toBe(reset.status);
			expect(await unknown.json()).toEqual(await reset.clone().json());
			expect(sendEmail).not.toHaveBeenCalled();

			// Approving an email change goes to the current address, in the account's language, naming both addresses.
			const cookie = signup.headers
				.getSetCookie()
				.map((value) => value.split(";", 1)[0])
				.join("; ");
			// Only a verified address is asked to approve; an unverified one gets the new address verified directly.
			await db.update(user).set({ emailVerified: true }).where(eq(user.email, email));
			sendEmail.mockClear();
			const newEmail = `layla-new-${unique}@example.test`;
			const change = await post("change-email", { newEmail, callbackURL: "/dashboard" }, `${cookie}; locale=en-US`);
			expect(change.status, await change.clone().text()).toBe(200);
			expect(await lastEmail()).toMatchObject({ to: email, subject: expect.stringMatching(arabic) });

			// An account from before languages were stored falls back to the language of the request.
			const legacy = `legacy-${unique}@example.test`;
			expect(
				(
					await post("sign-up/email", {
						name: "Legacy",
						email: legacy,
						username: `legacy-${unique}`,
						password: "password123",
					})
				).status,
			).toBe(200);
			const [legacyAccount] = await db.select({ locale: user.locale }).from(user).where(eq(user.email, legacy));
			expect(legacyAccount?.locale).toBeNull();
			expect(await lastEmail()).toMatchObject({ to: legacy, subject: "Verify your email" });
			sendEmail.mockClear();
			await post("request-password-reset", { email: legacy, redirectTo: "/auth/reset-password" }, "locale=ar-SA");
			expect(await lastEmail()).toMatchObject({ to: legacy, subject: expect.stringMatching(arabic) });
		},
	);
});
