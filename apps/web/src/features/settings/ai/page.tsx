import type { MemoryMode } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSearch } from "@tanstack/react-router";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useHasUsableAiProvider } from "../integrations/hooks/use-has-usable-ai-provider";
import { SettingsRow, SettingsSection } from "../section";
import { ApiKeysSection } from "./api-keys";
import { ConnectedAppsSection } from "./connected-apps";
import { McpSection } from "./mcp";
import { ProvidersSection } from "./providers";
import { AiUsageSection } from "./usage";
import { WebAccessSection } from "./web-access";
import { useProfile } from "@/features/career/knowledge/preferences";

/** What the app's own AI features run on: connections, this week's use, web access, and what AI may use. */
export function AiSettings() {
	const { hasUsableProvider } = useHasUsableAiProvider();
	return (
		<>
			<ProvidersSection />
			{/* With no connection there is nothing to count. */}
			{hasUsableProvider && <AiUsageSection />}
			<WebAccessSection />
			<WhatAiCanUse />
		</>
	);
}

/** What the coach may keep from your messages. The same setting is on Career › Knowledge. */
function WhatAiCanUse() {
	const { profile, save } = useProfile();
	const modes: Record<MemoryMode, { label: string; hint: string }> = {
		ask: { label: t`Ask first`, hint: t`A new fact is saved to Knowledge only after you agree` },
		auto: { label: t`Automatically`, hint: t`The coach saves facts you state, and tells you. You can undo.` },
		off: { label: t`Never`, hint: t`The coach doesn't remember anything from your messages` },
	};
	// Never claim a privacy default that wasn't read from the saved setting.
	if (!profile) return null;
	const mode = profile.memoryMode;
	return (
		<SettingsSection title={<Trans>What AI can use</Trans>}>
			<SettingsRow title={<Trans>Remember facts from my messages</Trans>} description={modes[mode].hint}>
				<DropdownMenu>
					<DropdownMenuTrigger
						aria-label={t`Remember facts from my messages: ${modes[mode].label}`}
						className="flex items-center gap-1 rounded-xs text-[13px]/[18px] font-medium text-ink-2 hover:text-ink"
					>
						{modes[mode].label}
						<Icon name="caret-down" size={16} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuRadioGroup value={mode} onValueChange={(value) => save({ memoryMode: value as MemoryMode })}>
							{(Object.keys(modes) as MemoryMode[]).map((value) => (
								<DropdownMenuRadioItem key={value} value={value}>
									{modes[value].label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SettingsRow>
		</SettingsSection>
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
