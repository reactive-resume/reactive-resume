import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";
import { isOAuthRedirect } from "../redirect";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";

type OAuthConsentPageProps = {
	oauthQuery: string;
	email: string;
};

/** Resolves with an error message, or null when Better Auth's redirect plugin takes over. */
async function requestConsent(accept: boolean, oauthQuery: string) {
	const failure = t`Could not complete this connection. Restart the connection from your client and try again.`;
	try {
		// This is the only point that grants access: an explicit button press.
		// Better Auth validates the signed request, session, and request origin.
		const { data, error } = await authClient.oauth2.consent({ accept, oauth_query: oauthQuery });
		if (error || !isOAuthRedirect(data)) return failure;
		// Better Auth's redirect plugin follows a successful provider response.
		return null;
	} catch {
		return failure;
	}
}

export function OAuthConsentPage({ oauthQuery, email }: OAuthConsentPageProps) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const query = new URLSearchParams(oauthQuery);
	const clientId = query.get("client_id") ?? "";
	const scopes = new Set(query.get("scope")?.split(" ") ?? []);
	const validRequest = !!clientId && query.has("sig");
	const {
		data: client,
		isPending,
		isError,
	} = useQuery({
		queryKey: ["oauth-client", clientId, oauthQuery],
		enabled: validRequest,
		retry: false,
		queryFn: async () => {
			const { data, error } = await authClient.oauth2.publicClient({ query: { client_id: clientId } });
			if (error || !data) throw new Error(t`This connection request is invalid or has expired.`);
			return data;
		},
	});

	async function submit(accept: boolean) {
		if (pending || !client || !validRequest) return;
		setPending(true);
		setError(undefined);
		const failure = await requestConsent(accept, oauthQuery);
		if (failure) {
			setError(failure);
			setPending(false);
		}
	}

	return (
		<>
			<div className="space-y-2 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">
					<Trans>Connect an application</Trans>
				</h1>
				<p className="text-sm wrap-anywhere text-ink-3">
					<Trans>Signed in as {email}</Trans>
				</p>
			</div>
			{!validRequest || isError ? (
				<p key="invalid" role="alert" className={ENTER_CLASS}>
					<Trans>This connection request is invalid or has expired.</Trans>
				</p>
			) : isPending ? (
				<p role="status">
					<Trans>Loading connection request...</Trans>
				</p>
			) : client ? (
				<div className={cn(ENTER_CLASS, "space-y-4")}>
					<div className="space-y-1 wrap-anywhere">
						<p className="font-medium">{client.client_name || clientId}</p>
						<p className="text-xs text-ink-3">
							<Trans>Client ID</Trans>: {clientId}
						</p>
					</div>
					<p className="text-sm">
						<Trans>Only allow applications you trust. This application will be able to:</Trans>
					</p>
					<ul className="list-disc space-y-2 pl-5 text-sm">
						{["api:read", "api:write", "api:delete"].some((scope) => scopes.has(scope)) ? (
							<>
								{scopes.has("api:read") && (
									<li>
										<Trans>Read your documents and job applications.</Trans>
									</li>
								)}
								{scopes.has("api:write") && (
									<li>
										<Trans>Create and change your documents and job applications.</Trans>
									</li>
								)}
								{scopes.has("api:delete") && (
									<li>
										<Trans>Delete your documents and account data.</Trans>
									</li>
								)}
							</>
						) : (
							<li>
								<Trans>
									Access your account through the API, including reading, changing and deleting your documents and job
									applications.
								</Trans>
							</li>
						)}
						{scopes.has("profile") && (
							<li>
								<Trans>Read your profile information.</Trans>
							</li>
						)}
						{scopes.has("email") && (
							<li>
								<Trans>Read your email address.</Trans>
							</li>
						)}
						{scopes.has("offline_access") && (
							<li>
								<Trans>Keep access when you are not using the application.</Trans>
							</li>
						)}
					</ul>
					{error && (
						<p role="alert" className={cn(ENTER_CLASS, "text-sm text-danger-text")}>
							{error}
						</p>
					)}
					<div className="flex gap-2">
						<Button className="flex-1" variant="secondary" disabled={pending} onClick={() => void submit(false)}>
							<Trans>Deny</Trans>
						</Button>
						<Button className="flex-1" disabled={pending} onClick={() => void submit(true)}>
							<Trans>Allow access</Trans>
						</Button>
					</div>
				</div>
			) : null}
		</>
	);
}
