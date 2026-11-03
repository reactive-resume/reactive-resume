import { t } from "@lingui/core/macro";

type AuthError = { code?: string | undefined; message?: string | undefined; status?: number | undefined };

export function authErrorMessage(error: AuthError, fallback: string): string {
	switch (error.code) {
		case "INVALID_EMAIL_OR_PASSWORD":
		case "INVALID_USERNAME_OR_PASSWORD":
			return t`That email, username or password doesn't match. Check them, or reset your password.`;
		case "INVALID_TWO_FACTOR_COOKIE":
			return t`This sign-in step expired. Sign in again.`;
		case "INVALID_TOKEN":
			return t`This reset link expired or was already used. Send a new link.`;
		case "INVALID_OTP":
		case "INVALID_BACKUP_CODE":
			return t`That code doesn't match. Check it and try again.`;
	}
	if (error.status === 429) return t`Too many attempts. Wait a moment, then try again.`;
	// Older servers return these product conflicts without codes. Keep their recovery guidance, never arbitrary text.
	switch (error.message) {
		case "Guest and account Career preferences differ. Your guest work is unchanged. Match Career preferences and Knowledge memory settings in both accounts before trying again.":
			return t`Guest and account Career preferences differ. Your guest work is unchanged. Match Career preferences and Knowledge memory settings in both accounts before trying again.`;
		case "Both accounts have a private application profile. Export and delete one profile in Settings → Account before linking, so neither is silently overwritten.":
			return t`Both accounts have a private application profile. Export and delete one profile in Settings → Account before linking, so neither is silently overwritten.`;
		case "Retire unused application lanes before combining these accounts; the combined pipeline exceeds 40 active lanes.":
			return t`Retire unused application lanes before combining these accounts; the combined pipeline exceeds 40 active lanes.`;
		case "Both accounts have duplicate saved application answers. Export and delete one copy before linking, so neither is silently overwritten.":
			return t`Both accounts have duplicate saved application answers. Export and delete one copy before linking, so neither is silently overwritten.`;
		default:
			return fallback;
	}
}
