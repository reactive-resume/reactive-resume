import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Swap } from "@reactive-resume/ui/components/swap";
import { SettingsSection } from "../section";
import { mcpConfig } from "./api-keys";

export function McpSection() {
	const address = `${window.location.origin}/mcp`;
	const [copied, setCopied] = useState(false);
	const [, copy] = useCopyToClipboard();

	return (
		<SettingsSection title={<Trans>MCP server</Trans>}>
			<p className="pb-2.5 text-[13px]/[18px] text-ink-3">
				<Trans>
					Lets an AI client work with your documents and applications. Sign in from the client, or use an API key.
				</Trans>
			</p>
			<div className="grid gap-3">
				<div className="flex items-center gap-2 rounded-lg bg-raised p-1.5 ps-3 shadow-[inset_0_0_0_1px_var(--control-border)]">
					<Icon name="plugs" size={18} className="shrink-0 text-ink-2" />
					<span className="min-w-0 flex-1 truncate font-mono text-[13px]/4 font-medium">{address}</span>
					<Button
						variant="secondary"
						size="sm"
						aria-live="polite"
						onClick={async () => {
							await copy(address);
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
					>
						<Icon name={copied ? "check" : "copy"} />
						<Swap swapped={copied} from={<Trans>Copy</Trans>} to={<Trans>Copied</Trans>} />
					</Button>
				</div>
				<p className="text-sm/5 text-ink-2">
					<Trans>Sign in from your AI client when it asks, or add a key to its config:</Trans>
				</p>
				{/* The same entry New key copies, with a placeholder where the key goes. */}
				<pre className="overflow-x-auto rounded-lg bg-sunken p-4 font-mono text-[13px]/5 text-ink">
					{mcpConfig(t`your-api-key`)}
				</pre>
				<a
					href="https://docs.rxresu.me/guides/using-the-mcp-server"
					target="_blank"
					rel="noopener noreferrer"
					className="flex w-fit items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
				>
					<Trans>Setup guide</Trans>
					<Icon name="arrow-square-out" size={16} />
				</a>
			</div>
		</SettingsSection>
	);
}
