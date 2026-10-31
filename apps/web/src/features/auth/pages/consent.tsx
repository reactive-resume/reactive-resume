import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";
import { isOAuthRedirect } from "../redirect";
import { authClient } from "@/libs/auth/client";
import { ENTER_CLASS } from "@/libs/motion";

type OAuthConsentPageProps = {
	oauthQuery: string;
	email: string;
	isAnonymous: boolean;
	disableSignups: boolean;
};

/** Resolves with an error message, or null when Better Auth's redirect plugin takes over. */
async function requestConsent(accept: boolean, oauthQuery: string) {
	const failure = t`Couldn't complete this connection. Restart the connection from your client and try again.`;
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

function redirectDestination(redirectUri: string | null) {
	if (!redirectUri) return null;
	try {
		const url = new URL(redirectUri);
		// Native apps return through their own scheme, which has no host.
		return url.host || url.protocol.replace(/:$/, "");
	} catch {
		return null;
	}
}

export function OAuthConsentPage({ oauthQuery, email, isAnonymous, disableSignups }: OAuthConsentPageProps) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const query = new URLSearchParams(oauthQuery);
	const clientId = query.get("client_id") ?? "";
	const scopes = new Set(query.get("scope")?.split(" ") ?? []);
	const validRequest = !!clientId && query.has("sig");
	// Anyone can register a client under any name, so show where the grant actually goes.
	const destination = redirectDestination(query.get("redirect_uri"));
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
			if (error || !data)
				throw new Error(
					t`This connection request is invalid or has expired. Start the connection again from your client.`,
				);
			return data;
		},
	});

	async function submit(accept: boolean) {
		// Guests may only decline, which returns them to the client without granting anything.
		if (pending || !client || !validRequest || (isAnonymous && accept)) return;
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
				<h1 className="text-[30px] leading-9">
					<Trans>Connect an application</Trans>
				</h1>
				{!isAnonymous && (
					<p className="text-sm wrap-anywhere text-ink-3">
						<Trans>Signed in as {email}</Trans>
					</p>
				)}
			</div>
			{isAnonymous ? (
				<div className="space-y-4">
					<p>
						<Trans>Create an account to connect apps. Guest accounts are temporary.</Trans>
					</p>
					<div className="flex flex-wrap gap-2">
						{!disableSignups && (
							<Button
								className="flex-1"
								nativeButton={false}
								render={<Link to="/auth/register" search={{ callbackURL: `/api/auth/oauth?${oauthQuery}` }} />}
							>
								<Trans>Create account</Trans>
							</Button>
						)}
						<Button
							className="flex-1"
							nativeButton={false}
							variant="secondary"
							render={<Link to="/auth/login" search={{ callbackURL: `/api/auth/oauth?${oauthQuery}` }} />}
						>
							<Trans>Sign in</Trans>
						</Button>
					</div>
					{client && (
						<Button className="w-full" variant="ghost" disabled={pending} onClick={() => void submit(false)}>
							<Trans>Cancel connection</Trans>
						</Button>
					)}
					{error && (
						<p role="alert" className={cn(ENTER_CLASS, "text-sm text-danger-text")}>
							{error}
						</p>
					)}
				</div>
			) : !validRequest || isError ? (
				<p key="invalid" role="alert" className={ENTER_CLASS}>
					<Trans>This connection request is invalid or has expired. Start the connection again from your client.</Trans>
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
						{destination && (
							<p className="text-xs text-ink-3">
								<Trans>Access is sent to</Trans>: <span className="font-medium text-ink">{destination}</span>
							</p>
						)}
					</div>
					<p className="text-sm">
						<Trans>Only allow applications you trust. This application will be able to:</Trans>
					</p>
					<ul className="list-disc space-y-2 pl-5 text-sm">
						{["api:read", "api:write", "api:delete"].some((scope) => scopes.has(scope)) ? (
							<>
								{scopes.has("api:read") && (
									<li>
										<Trans>
											Read your whole account, including a full data export: your profile and email, documents, job
											applications, career data and coaching conversations.
										</Trans>
									</li>
								)}
								{scopes.has("api:write") && (
									<li>
										<Trans>
											Create and change your documents and job applications, seeing each one it changes in full, and
											change your profile and username.
										</Trans>
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
							<Trans>Deny access</Trans>
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
