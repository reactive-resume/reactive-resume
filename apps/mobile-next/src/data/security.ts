import { Directory } from "expo-file-system";
import { openBrowserAsync } from "expo-web-browser";
import { usePlatformActions } from "./actions";
import { isFake } from "./fixtures";
import { activeDataScope, assertDataScope } from "./scope";
import { getServer } from "@/auth/session";
export type AccountSettingsSection = "passkeys" | "sessions" | "two-step" | "password" | "delete-account";
/** Cookie-session-only security operations keep re-verification inside the server's account flow. */
export async function openAccountSecurity(section: AccountSettingsSection) {
	const scope = activeDataScope();
	if (isFake()) return { state: "storyboard" as const };
	const url = new URL("/dashboard/settings/account", getServer());
	if (section === "delete-account") url.searchParams.set("deleteAccount", "true");
	else url.hash = section;
	const result = await openBrowserAsync(url.href);
	assertDataScope(scope);
	return { state: "browser-closed" as const, result };
}
export function useAccountActions() {
	const actions = usePlatformActions();
	return {
		openSecurity: openAccountSecurity,
		async exportEverything() {
			const scope = activeDataScope();
			const data = await actions.run("auth.exportData", { includeUploads: true });
			assertDataScope(scope);
			const folder = await Directory.pickDirectoryAsync();
			assertDataScope(scope);
			const file = folder.createFile("reactive-resume-account.json", "application/json");
			file.write(JSON.stringify(data));
			return { uri: file.uri, data };
		},
	};
}
