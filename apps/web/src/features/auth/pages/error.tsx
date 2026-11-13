import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Icon } from "@reactive-resume/ui/components/icon";
import { AuthTitle, authAction } from "../components/auth-page";

/** Every cause has its sentence, and where there is one, what to do about it. */
function getErrorMessage(code: string | undefined): { cause: string; action?: string } {
	switch (code) {
		case "access_denied":
			return { cause: t`You canceled the sign-in before it finished.`, action: t`Try again when you're ready.` };
		case "no_code":
		case "state_not_found":
		case "invalid_callback_request":
			return { cause: t`This sign-in attempt expired or was already used.`, action: t`Try again.` };
		case "invalid_code":
			return { cause: t`The provider rejected this sign-in attempt.`, action: t`Try again.` };
		case "oauth_provider_not_found":
			return {
				cause: t`That sign-in provider is no longer available on this server.`,
				action: t`Use another sign-in method.`,
			};
		case "issuer_missing":
		case "issuer_mismatch":
		case "nonce_binding_missing":
			return { cause: t`The provider's response couldn't be verified.`, action: t`Try again.` };
		case "unable_to_get_user_info":
			return { cause: t`Couldn't read your profile from the provider.`, action: t`Try again.` };
		case "email_not_found":
			return {
				cause: t`The provider didn't share an email address, and an account needs one.`,
				action: t`Allow email access when the provider asks, or use another sign-in method.`,
			};
		case "email_not_verified":
			return {
				cause: t`Your email address isn't verified with the provider.`,
				action: t`Verify it there, then try again.`,
			};
		case "email_does_not_match":
			return {
				cause: t`That provider account uses a different email address than your account.`,
				action: t`Use a provider account with the same email address.`,
			};
		case "account_already_linked_to_different_user":
			return {
				cause: t`That provider account is already linked to another account.`,
				action: t`Use a different provider account.`,
			};
		case "unable_to_link_account":
			return { cause: t`Couldn't link that provider account.`, action: t`Try again.` };
		case "signup_disabled":
			return {
				cause: t`This server isn't accepting new accounts.`,
				action: t`Sign in with an existing account.`,
			};
		case "invalid_client":
		case "client_disabled":
		case "unauthorized_client":
		case "invalid_redirect":
		case "unsupported_response_type":
			return {
				cause: t`The application that sent you here made an invalid authorization request.`,
				action: t`Return to the application and try again.`,
			};
		default:
			return { cause: t`Couldn't sign you in.`, action: t`Try again.` };
	}
}

type AuthErrorPageProps = {
	code: string | undefined;
	description: string | undefined;
};

export function AuthErrorPage({ code, description }: AuthErrorPageProps) {
	const context = useRouteContext({ strict: false });
	// Sign-in flows start signed out, so anyone who is already authenticated got here from the
	// "link a provider" flow in settings and should land back there rather than on a login form.
	const returnsToSettings = Boolean(context.session);
	const { cause, action } = getErrorMessage(code);
	// The provider's own words when it sent any, else its code: enough to look the failure up.
	const detail = description || code;

	return (
		<>
			<AuthTitle>
				<Trans comment="Title on the page shown after a failed or cancelled OAuth sign-in">
					Sign-in didn't complete
				</Trans>
			</AuthTitle>

			<Alert variant="error" className="mt-[18px]">
				<Icon name="warning-circle" />
				<AlertTitle>{cause}</AlertTitle>
				{action && <AlertDescription>{action}</AlertDescription>}
			</Alert>

			{detail && (
				<p className="mt-3 t-mono wrap-anywhere text-ink-3">
					<Trans comment="Label before the raw error text forwarded by the identity provider">
						Details from the provider: {detail}
					</Trans>
				</p>
			)}

			{returnsToSettings ? (
				<Link to="/dashboard/settings/account" className={authAction("primary", "mt-6")}>
					<Trans comment="Action returning a signed-in user to the page where they manage linked providers">
						Back to account settings
					</Trans>
				</Link>
			) : (
				<Link to="/auth/login" className={authAction("primary", "mt-6")}>
					<Trans comment="Action returning the visitor to the sign-in page after a failed sign-in">
						Back to sign in
					</Trans>
				</Link>
			)}
		</>
	);
}
