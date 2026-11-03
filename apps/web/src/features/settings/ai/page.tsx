import { Trans } from "@lingui/react/macro";
import { useSearch } from "@tanstack/react-router";
import { ApiKeysSection } from "./api-keys";
import { ConnectedAppsSection } from "./connected-apps";
import { McpSection } from "./mcp";
import { ProvidersSection } from "./providers";
import { AiUsageSection } from "./usage";
import { WebAccessSection } from "./web-access";
import { PageHeader } from "@/components/layout/page-header";

/** Providers and API keys together: both connect outside tools. */
export function AiDeveloperSettings() {
	const { newKey } = useSearch({ from: "/dashboard/settings/ai" });
	return (
		<>
			<PageHeader
				title={<Trans>AI &amp; developer</Trans>}
				description={<Trans>Connect the tools you use for writing, job search and working with your resumes.</Trans>}
			/>
			<ProvidersSection />
			<AiUsageSection />
			<WebAccessSection />
			<ApiKeysSection openNewKey={newKey ?? false} />
			<ConnectedAppsSection />
			<McpSection />
		</>
	);
}
