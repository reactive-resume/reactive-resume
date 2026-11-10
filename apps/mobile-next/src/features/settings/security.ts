// What S2 and S5 show about credentials and developer access that the data layer doesn't carry yet (password age,
// two-step, passkeys, connected apps, API keys, web access). Each is a reported gap: real accounts show the rows
// without a state line until a hook exists. The storyboard account's states are the board's.
import { t } from "@lingui/core/macro";
import { useDataBackend, useConnectedApps, useAPIKeys } from "@/data";

export type AccountSecurity = {
	password?: string;
	twoStep?: string;
	passkeys?: string;
	connectedApps?: string;
	exportReady?: string;
};

export type DeveloperAccess = {
	webAccess?: string;
	rememberFacts?: string;
	apiKeys?: string;
	connectedApplications?: string;
};

export function useAccountSecurity(): AccountSecurity {
	const { backend } = useDataBackend();
	const apps = useConnectedApps();
	if (backend.kind !== "fake")
		return apps.data ? { connectedApps: t`${apps.data.connections.length} connected applications` } : {};
	return {
		password: t`Changed 3 months ago`,
		twoStep: t`On · authenticator app`,
		passkeys: t`1 passkey · this phone`,
		connectedApps: t`Claude and 1 other`,
	};
}

export function useDeveloperAccess(): DeveloperAccess {
	const { backend } = useDataBackend();
	const apps = useConnectedApps();
	const keys = useAPIKeys();
	if (backend.kind !== "fake")
		return {
			...(apps.data ? { connectedApplications: t`${apps.data.connections.length} connected applications` } : {}),
			...(keys.data ? { apiKeys: t`${keys.data.total} keys` } : {}),
		};
	return {
		webAccess: t`Not set up`,
		rememberFacts: t`Ask first`,
		apiKeys: t`2 keys · newest read only`,
		connectedApplications: "Claude Desktop",
	};
}
