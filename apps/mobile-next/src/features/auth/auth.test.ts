import { parseConsentRequest } from "./consent-request";
import { signInMethods } from "./methods";

describe("signInMethods", () => {
	it("shows only what the server reports, with Apple beside any other social provider", () => {
		expect(signInMethods({ credential: "Email", passkey: "Passkey", github: "GitHub" }, "sign-in")).toEqual([
			"passkey",
			"github",
			"apple",
		]);
		expect(signInMethods({ credential: "Email", passkey: "Passkey" }, "sign-in")).toEqual(["passkey"]);
	});

	it("drops the passkey on sign-up", () => {
		expect(signInMethods({ passkey: "Passkey", google: "Google" }, "register")).toEqual(["google", "apple"]);
	});
});

describe("parseConsentRequest", () => {
	it("names the redirect's host, never the query's own client name", () => {
		const request = parseConsentRequest(
			{
				client_id: "abc",
				sig: "s",
				client_name: "Reactive Resume",
				redirect_uri: "https://claude.ai/callback",
				scope: "openid api:read",
			},
			false,
		);
		expect(request?.clientName).toBe("claude.ai");
		expect([...(request?.scopes ?? [])]).toEqual(["openid", "api:read"]);
	});

	it("rejects an unsigned request on a real server", () => {
		expect(parseConsentRequest({ client_id: "abc", redirect_uri: "https://x.test" }, false)).toBeNull();
	});
});
