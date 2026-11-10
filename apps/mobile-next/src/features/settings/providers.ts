import type { RouterOutput } from "@/api/client";
// AI provider view-model shared by S1, S5, S6 and S7: names, short failure words and the test action.
// Provider mutations (create, update, test, make default, delete) have no data hook yet (reported): on a real server
// they finish on the server's AI settings page; the storyboard server answers here.
import { t } from "@lingui/core/macro";
import { AI_PROVIDER_DEFAULT_BASE_URLS, AI_PROVIDER_DISPLAY_NAMES, type AIProvider } from "@reactive-resume/ai/types";

export type Provider = RouterOutput["aiProviders"]["list"][number];

export const providerName = (provider: string) => AI_PROVIDER_DISPLAY_NAMES[provider as AIProvider] ?? provider;

const localHosts = /^(localhost|127\.0\.0\.1|\[::1\]|[^.]+\.local)(:\d+)?$/i;

export function providerHost(provider: Pick<Provider, "baseURL" | "provider">): string {
	const url = provider.baseURL || AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider as AIProvider] || "";
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export const isLocal = (host: string) => localHosts.test(host);

/** A failed row's own words: "Can't reach localhost:11434", "Key rejected". */
export function shortTestError(kind: string | null | undefined, host: string): string {
	switch (kind) {
		case "network":
			return t`Can't reach ${host}`;
		case "auth":
			return t`Key rejected`;
		case "model":
			return t`Model not available`;
		case "rate-limit":
			return t`Rate limited`;
		default:
			return t`Test failed`;
	}
}

/** The full sentence under S6's key field (the web's test-error.ts). */
export function providerTestError(kind?: string | null) {
	switch (kind) {
		case "auth":
			return t`The key was rejected. Check the key and test again.`;
		case "model":
			return t`The model wasn't available or couldn't complete the test. Check its name or try another model.`;
		case "network":
			return t`The service couldn't be reached. Check the address and connection, then try again.`;
		case "url":
			return t`Enter the API base URL of your service and test again.`;
		case "rate-limit":
			return t`The provider limited this request. Wait and try again; check your account quota.`;
		case "server":
			return t`The provider reported a server error. Try again later.`;
		default:
			return t`The connection test failed. Check the key, model and address, then try again.`;
	}
}
