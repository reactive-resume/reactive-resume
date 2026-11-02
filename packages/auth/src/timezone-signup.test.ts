import { describe, expect, it, vi } from "vite-plus/test";
import { env } from "@reactive-resume/env/server";

const oauthState = vi.hoisted(() => ({
	addOAuthServerContext: vi.fn(),
	getOAuthState: vi.fn<() => Promise<{ serverContext?: { timezone?: unknown; locale?: unknown } } | null>>(),
}));

vi.mock("better-auth/api", async (importOriginal) => ({
	...(await importOriginal<typeof import("better-auth/api")>()),
	...oauthState,
}));

const { auth } = await import("./config");

const now = new Date();
const newUser = {
	id: "new-user",
	email: "new-user@example.test",
	emailVerified: false,
	name: "New user",
	createdAt: now,
	updatedAt: now,
};

describe("social sign-up timezone and language", () => {
	const createBefore = auth.options.databaseHooks?.user?.create?.before;

	if (!createBefore) throw new Error("Missing user create hook");

	it("keeps the device timezone across the provider redirect", async () => {
		oauthState.getOAuthState.mockResolvedValue(null);

		await auth.handler(
			new Request(`${env.APP_URL}/api/auth/sign-in/social`, {
				method: "POST",
				headers: new Headers({
					"content-type": "application/json",
					origin: env.APP_URL,
					"x-client-timezone": "Europe/Berlin",
				}),
				body: JSON.stringify({ provider: "github" }),
			}),
		);

		expect(oauthState.addOAuthServerContext).toHaveBeenCalledWith({ timezone: "Europe/Berlin" });
	});

	it("starts the account from the timezone saved in the OAuth state", async () => {
		oauthState.getOAuthState.mockResolvedValue({ serverContext: { timezone: "Europe/Berlin" } });

		await expect(createBefore(newUser, { headers: new Headers() } as never)).resolves.toEqual({
			data: expect.objectContaining({ timezone: "Europe/Berlin" }),
		});
	});

	it("ignores an invalid timezone in the OAuth state", async () => {
		oauthState.getOAuthState.mockResolvedValue({ serverContext: { timezone: "Not/A_Timezone" } });

		await expect(createBefore(newUser, { headers: new Headers() } as never)).resolves.toBeUndefined();
	});

	it("keeps the interface language across the provider redirect", async () => {
		oauthState.addOAuthServerContext.mockClear();
		oauthState.getOAuthState.mockResolvedValue(null);

		await auth.handler(
			new Request(`${env.APP_URL}/api/auth/sign-in/social`, {
				method: "POST",
				headers: new Headers({ "content-type": "application/json", origin: env.APP_URL, cookie: "locale=ar-SA" }),
				body: JSON.stringify({ provider: "github" }),
			}),
		);

		expect(oauthState.addOAuthServerContext).toHaveBeenCalledWith({ locale: "ar-SA" });
	});

	it("starts the account in the language saved in the OAuth state", async () => {
		oauthState.getOAuthState.mockResolvedValue({ serverContext: { locale: "ar-SA" } });

		await expect(createBefore(newUser, { headers: new Headers() } as never)).resolves.toEqual({
			data: expect.objectContaining({ locale: "ar-SA" }),
		});
	});
});
