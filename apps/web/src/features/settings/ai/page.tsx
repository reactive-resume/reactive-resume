import { useSearch } from "@tanstack/react-router";
import { ApiKeysSection } from "./api-keys";
import { ConnectedAppsSection } from "./connected-apps";
import { McpSection } from "./mcp";
import { ProvidersSection } from "./providers";
import { AiUsageSection } from "./usage";
import { WebAccessSection } from "./web-access";

/** What the app's own AI features run on: providers, their usage, and web access. */
export function AiSettings() {
	return (
		<>
			<ProvidersSection />
			<AiUsageSection />
			<WebAccessSection />
		</>
	);
}

/** What lets outside tools act as this account: API keys, connected applications and the MCP server. */
export function DeveloperSettings() {
	const { newKey } = useSearch({ from: "/dashboard/settings/developer" });
	return (
		<>
			<ApiKeysSection openNewKey={newKey ?? false} />
			<ConnectedAppsSection />
			<McpSection />
		</>
	);
}
