import { ApiKeysSection } from "./api-keys";
import { McpSection } from "./mcp";
import { ProvidersSection } from "./providers";
import { WebAccessSection } from "./web-access";

/** Providers and API keys together: both connect outside tools. */
export function AiDeveloperSettings() {
	return (
		<>
			<ProvidersSection />
			<WebAccessSection />
			<ApiKeysSection />
			<McpSection />
		</>
	);
}
