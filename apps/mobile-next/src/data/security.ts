import { t } from "@lingui/core/macro";
import { Directory } from "expo-file-system";
import { openBrowserAsync } from "expo-web-browser";
import { usePlatformActions } from "./actions";
import { isFake } from "./fixtures";
import { useConnectedApps, useAPIKeys } from "./platform";
import { useDataBackend, useResource } from "./provider";
import { activeDataScope, assertDataScope } from "./scope";
import { getServer, getSession } from "@/auth/session";
export type AccountSettingsSection = "passkeys" | "sessions" | "two-step" | "password" | "delete-account" | "api-keys";
/** Cookie-session-only security operations keep re-verification inside the server's account flow. */
export async function openAccountSecurity(section: AccountSettingsSection) {
	const scope = activeDataScope();
	if (isFake()) return { state: "storyboard" as const };
	if (getSession().status !== "signed-in") throw new Error(t`Sign in again.`);
	const [, userId] = JSON.parse(scope) as [string, string];
	const url = new URL(section === "api-keys" ? "/dashboard/settings/ai" : "/dashboard/settings/account", getServer());
	url.searchParams.set("forAccount", userId);
	if (section === "api-keys") {
		url.searchParams.set("newKey", "true");
		url.hash = "api-keys";
	} else if (section === "delete-account") url.searchParams.set("deleteAccount", "true");
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

/** Bearer clients can enumerate keys/apps; cookie-only security state stays explicitly unknown. */
export function useSecurityState() {
	const { backend } = useDataBackend();
	const apps = useConnectedApps();
	const keys = useAPIKeys();
	const webAccess = useResource("webAccess", {});
	const browser = { availability: "open-in-browser" as const };
	return {
		password:
			backend.kind === "fake"
				? { availability: "available" as const, changedAt: new Date("2026-08-07T08:41:00Z") }
				: browser,
		twoStep:
			backend.kind === "fake"
				? { availability: "available" as const, enabled: true, method: "authenticator" }
				: browser,
		passkeys: backend.kind === "fake" ? { availability: "available" as const, count: 1, thisPhone: true } : browser,
		sessions: browser,
		webAccess,
		connectedApps: apps,
		apiKeys: keys,
	};
}
