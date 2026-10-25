import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { ServerError } from "./oauth";

/** What the user reads when `signIn` fails. Error codes come from the browser redirect or the token endpoint. */
export function signInErrorMessage(i18n: I18n, error: unknown): string {
	if (error instanceof ServerError) return serverErrorMessage(i18n, error);
	const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
	switch (code) {
		case "access_denied":
			return i18n._(msg`You canceled the sign-in before it finished.`);
		case "invalid_grant":
		case "state_mismatch":
		case "issuer_mismatch":
			return i18n._(msg`This sign-in attempt expired or was already used. Sign in again.`);
		default:
			return i18n._(msg`Couldn't sign you in. Try again.`);
	}
}

export function serverErrorMessage(i18n: I18n, error: ServerError): string {
	if (error.reason === "mismatch")
		return i18n._(
			msg`This server reports a different address than the one you entered. Enter the address it uses, or ask your administrator.`,
		);
	return error.reason === "outdated"
		? i18n._(msg`This server is too old for the app. Ask your administrator to update it.`)
		: i18n._(
				msg`No Reactive Resume server answered at this address. Check the spelling, or ask your administrator whether the server allows app sign-in.`,
			);
}
