import { describe, expect, it } from "vitest";
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

it("publishes the configured native authentication HTTP contract", async () => {
	const response = await auth.handler(new Request(`${env.APP_URL}/api/auth/open-api/generate-schema`));
	expect(response.status).toBe(200);
	const spec = await response.json();
	expect(spec.paths).toHaveProperty("/sign-in/email");
	expect(spec.paths).toHaveProperty("/get-session");
	expect(spec.paths).toHaveProperty("/api-key/create");
});
