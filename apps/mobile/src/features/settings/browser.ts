import { openBrowserAsync } from "expo-web-browser";
import { getAccountScope } from "@/auth/session";

type AccountSettingsPath =
	| "/dashboard/settings/account"
	| `/dashboard/settings/account#${"email" | "password" | "two-step" | "passkeys" | "linked-accounts"}`
	| "/dashboard/settings/account?deleteAccount=true"
	| "/dashboard/settings/ai"
	| "/dashboard/settings/ai?newKey=true#api-keys";

/** Browser cookies stay in the browser; the account hint never grants authorization. */
export async function openAccountSettings(
	path: AccountSettingsPath = "/dashboard/settings/account",
	scope = getAccountScope(),
) {
	if (!scope || getAccountScope() !== scope) return false;
	const [server, userId] = JSON.parse(scope) as [string, string];
	const url = new URL(path, server);
	url.searchParams.set("forAccount", userId);
	await openBrowserAsync(url.href);
	return getAccountScope() === scope;
}
