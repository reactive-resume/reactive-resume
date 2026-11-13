import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { getOAuthSignInOptions } from "../redirect";
import { AuthLead } from "./auth-page";
import { authClient } from "@/libs/auth/client";

type ConnectingClientProps = {
	callbackURL: unknown;
	register?: boolean;
	/** The page's own sentence, shown when no application is waiting. */
	children: ReactNode;
};

/**
 * The sentence under the title of sign-in and sign-up. Mid-OAuth it says which app is waiting, so people arriving from
 * an AI client know why they're here.
 * The name comes from the provider's signed-request check; a forged or expired request falls back to the generic line.
 */
export function ConnectingClient({ callbackURL, register = false, children }: ConnectingClientProps) {
	const oauthQuery = getOAuthSignInOptions(callbackURL).oauth_query;
	const clientId = oauthQuery ? new URLSearchParams(oauthQuery).get("client_id") : null;
	const { data: name } = useQuery({
		// Its own key: the consent page caches the whole client object under "oauth-client".
		queryKey: ["oauth-client-name", clientId, oauthQuery],
		enabled: !!oauthQuery && !!clientId,
		retry: false,
		queryFn: async () => {
			const { data } = await authClient.oauth2.publicClientPrelogin({
				client_id: clientId ?? "",
				oauth_query: oauthQuery ?? "",
			});
			return data?.client_name?.trim() || null;
		},
	});
	if (!oauthQuery) return <AuthLead>{children}</AuthLead>;
	return (
		<AuthLead>
			{register ? (
				name ? (
					<Trans>Create an account to connect {name}.</Trans>
				) : (
					<Trans>Create an account to connect an application.</Trans>
				)
			) : name ? (
				<Trans>Sign in to connect {name}.</Trans>
			) : (
				<Trans>Sign in to connect an application.</Trans>
			)}
		</AuthLead>
	);
}
