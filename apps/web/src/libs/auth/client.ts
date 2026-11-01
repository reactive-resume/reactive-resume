import type { auth } from "@reactive-resume/auth/config";
import { apiKeyClient } from "@better-auth/api-key/client";
import { dashClient } from "@better-auth/infra/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import {
	adminClient,
	anonymousClient,
	inferAdditionalFields,
	twoFactorClient,
	usernameClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { isSessionIntentPath } from "@reactive-resume/utils/auth-intent";
import { getAccountId } from "./account-scope";
import { authSearchSchema } from "@/features/auth/redirect";

export const authClient = createAuthClient({
	// New accounts start in the device timezone instead of UTC. Social sign-in carries this into the
	// OAuth state on the server; email and guest creation read it directly. A static header merges
	// with per-call options, unlike a global onRequest that a per-call one would replace.
	fetchOptions: {
		headers: { "x-client-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" },
		// Better Auth talks to /api/auth directly, outside the RPC transport. Account settings writes still belong to
		// the account whose page rendered them, so a cookie swapped in another tab cannot apply them to the new user.
		onRequest: (context) => {
			if (context.method === "GET" || context.method === "HEAD") return;
			const path =
				typeof context.url === "string" ? new URL(context.url, window.location.origin).pathname : context.url.pathname;
			if (isSessionIntentPath(path)) return;
			const accountId = getAccountId();
			if (accountId) context.headers.set("x-account-id", accountId);
		},
	},
	plugins: [
		dashClient(),
		adminClient(),
		apiKeyClient(),
		passkeyClient(),
		usernameClient(),
		anonymousClient(),
		twoFactorClient({
			onTwoFactorRedirect() {
				// Redirect to 2FA verification page
				const { callbackURL, reauthenticate } = authSearchSchema.parse({
					reauthenticate: new URLSearchParams(window.location.search).get("reauthenticate") === "true",
					callbackURL: new URLSearchParams(window.location.search).get("callbackURL"),
				});
				const search = callbackURL
					? `?${new URLSearchParams({ callbackURL, ...(reauthenticate ? { reauthenticate: "true" } : {}) })}`
					: "";
				window.location.href = `/auth/verify-2fa${search}`;
			},
		}),
		oauthProviderClient(),
		inferAdditionalFields<typeof auth>(),
	],
});
