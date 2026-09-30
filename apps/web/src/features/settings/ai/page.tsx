import { ApiKeysSection } from "./api-keys";
import { FirecrawlSection } from "./firecrawl";
import { McpSection } from "./mcp";
import { ProvidersSection } from "./providers";

/** Providers and API keys together: both connect outside tools. */
export function AiDeveloperSettings() {
	return (
		<>
			<ProvidersSection />
			<FirecrawlSection />
			<ApiKeysSection />
			<McpSection />
		</>
	);
}
