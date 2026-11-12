import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { AuthFoot, AuthLead, AuthTitle, authAction } from "../components/auth-page";
import { isOAuthRedirect } from "../redirect";
import { IconTile } from "@/components/calm/list-row";
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
		if (url.protocol === "http:" || url.protocol === "https:") return url.host;
		// Any installed app can claim a custom scheme, even one spelled like a website, so keep the scheme and its
		// separator: a site's host never ends in ":".
		return url.host ? `${url.protocol}//${url.host}` : url.protocol;
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
			// The provider checks the request's signature and expiry here, so a forged or expired request reads as invalid.
			const { data, error } = await authClient.oauth2.publicClientPrelogin({
				client_id: clientId,
				oauth_query: oauthQuery,
			});
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

	const api = { read: scopes.has("api:read"), write: scopes.has("api:write"), delete: scopes.has("api:delete") };
	const callbackURL = `/api/auth/oauth?${oauthQuery}`;
	const failure = error && (
		<p role="alert" className={cn(ENTER_CLASS, "mt-4 text-danger-text t-small")}>
			{error}
		</p>
	);
	const title = (
		<AuthTitle>
			<Trans>Connect an application</Trans>
		</AuthTitle>
	);

	// Settle the request before offering anything: sign-up links would only resume a dead request.
	if (!validRequest || isError)
		return (
			<>
				{title}
				<Alert key="invalid" variant="warn" role="alert" className={cn(ENTER_CLASS, "mt-4")}>
					<Icon name="warning-circle" />
					<AlertDescription>
						<Trans>
							This connection request is invalid or has expired. Start the connection again from your client.
						</Trans>
					</AlertDescription>
				</Alert>
				<Link to="/dashboard" className={authAction("secondary", "mt-5")}>
					<Trans>Go to Today</Trans>
				</Link>
			</>
		);

	if (isPending)
		return (
			<>
				{title}
				<AuthLead role="status">
					<Trans>Loading connection request…</Trans>
				</AuthLead>
			</>
		);

	if (isAnonymous)
		return (
			<>
				{title}
				<AuthLead>
					<Trans>Create an account to connect apps. Guest accounts are temporary.</Trans>
				</AuthLead>
				<div className="mt-7 flex flex-col gap-3">
					{!disableSignups && (
						<Link to="/auth/register" search={{ callbackURL }} className={authAction("primary")}>
							<Trans>Create account</Trans>
						</Link>
					)}
					<Link
						to="/auth/login"
						search={{ callbackURL }}
						className={authAction(disableSignups ? "primary" : "secondary")}
					>
						<Trans>Sign in</Trans>
					</Link>
				</div>
				{client && (
					<AuthFoot>
						<button type="button" disabled={pending} onClick={() => void submit(false)}>
							<Trans>Cancel connection</Trans>
						</button>
					</AuthFoot>
				)}
				{failure}
			</>
		);

	if (!client) return title;

	return (
		<>
			{title}
			<AuthLead>
				<Trans>Signed in as {email}</Trans>
			</AuthLead>

			<div className={cn(ENTER_CLASS, "flex flex-col")}>
				{/* Who is asking and where access goes: anyone can register a client under any name. */}
				<div className="mt-6 flex items-center gap-3 border-y border-line py-3">
					<IconTile>
						<Icon name="plugs" size={20} />
					</IconTile>
					<span className="flex min-w-0 flex-1 flex-col wrap-anywhere">
						<span className="t-label">{client.client_name || clientId}</span>
						{destination && (
							<span className="text-ink-3 t-small">
								{/* One message, so translators can place the address where their language puts it. */}
								<Trans>
									Access is sent to <span className="font-semibold text-ink">{destination}</span>
								</Trans>
							</span>
						)}
					</span>
					<span className="max-w-[40%] shrink-0 truncate text-ink-3 t-mono" title={`${t`Client ID`}: ${clientId}`}>
						<Trans comment="Short label before an application's client ID">ID {clientId}</Trans>
					</span>
				</div>

				<p className="mt-4 t-ui">
					<Trans>Only allow applications you trust. This one will be able to:</Trans>
				</p>
				<ul className="mt-3 flex flex-col gap-2.5 t-ui">
					{api.read || api.write || api.delete ? (
						<>
							{api.read && (
								<Permission icon="eye">
									<Trans>
										Read your whole account, including a full export: profile and email, documents, applications, Career
										data and coaching conversations.
									</Trans>
								</Permission>
							)}
							{api.write && (
								<Permission icon="pencil-simple">
									<Trans>
										Create and change your documents and applications, seeing each one it changes in full, and change
										your profile and username.
									</Trans>
								</Permission>
							)}
							{api.delete && (
								<Permission icon="trash">
									<Trans>Delete your documents and account data.</Trans>
								</Permission>
							)}
						</>
					) : (
						<Permission icon="key">
							<Trans>
								Access your account through the API, including reading, changing and deleting your documents and
								applications.
							</Trans>
						</Permission>
					)}
					{/* Reading the whole account already covers the profile and email address. */}
					{scopes.has("profile") && !api.read && (
						<Permission icon="user">
							<Trans>Read your profile information.</Trans>
						</Permission>
					)}
					{scopes.has("email") && !api.read && (
						<Permission icon="envelope-simple">
							<Trans>Read your email address.</Trans>
						</Permission>
					)}
					{scopes.has("offline_access") && (
						<Permission icon="clock">
							<Trans>Keep access when you are not using it.</Trans>
						</Permission>
					)}
				</ul>
				<p className="mt-3.5 text-ink-3 t-small">
					{/* Only true when the request names what it wants and leaves deleting out. */}
					{(api.read || api.write) && !api.delete && (
						<>
							<Trans>It can't delete anything.</Trans>{" "}
						</>
					)}
					<Trans>You can disconnect it anytime in Settings › Developer.</Trans>
				</p>
				{failure}
				<div className="mt-5 grid grid-cols-2 gap-3">
					<Button
						variant="secondary"
						size="lg"
						className="leading-5"
						disabled={pending}
						onClick={() => void submit(false)}
					>
						<Trans>Deny access</Trans>
					</Button>
					<Button size="lg" className="leading-5" disabled={pending} onClick={() => void submit(true)}>
						<Trans>Allow access</Trans>
					</Button>
				</div>
			</div>
		</>
	);
}

function Permission({ icon, children }: { icon: IconName; children: ReactNode }) {
	return (
		<li className="flex items-start gap-3">
			<Icon name={icon} size={18} className="mt-0.5 shrink-0 text-ink-2" />
			<span>{children}</span>
		</li>
	);
}
