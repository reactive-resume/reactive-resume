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
			<div className="flex flex-wrap items-center gap-2">
				<span className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-control-border bg-raised px-3 font-mono text-[13px]/4 font-medium">
					{address}
				</span>
				<Button
					variant="secondary"
					aria-live="polite"
					onClick={async () => {
						if (await copy(address)) {
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}
					}}
				>
					<Icon name={copied ? "check" : "copy"} />
					<Swap swapped={copied} from={<Trans>Copy</Trans>} to={<Trans>Copied</Trans>} />
				</Button>
				<a
					href="https://docs.rxresu.me/guides/using-the-mcp-server"
					target="_blank"
					rel="noopener noreferrer"
					className="flex h-9 items-center gap-1.5 px-3.5 text-sm font-medium text-ink-2 hover:underline"
				>
					<Trans>Setup guide</Trans>
					<Icon name="arrow-square-out" size={16} />
				</a>
			</div>
			<details className="pt-2 text-[13px]/[18px] text-ink-3">
				<summary className="w-fit cursor-pointer">
					<Trans>Connection details</Trans>
				</summary>
				<p className="py-3 text-sm/5 text-ink-2">
					<Trans>Sign in from your AI client when it asks, or add a key to its config:</Trans>
				</p>
				<pre className="overflow-x-auto rounded-lg bg-sunken p-4 font-mono text-[13px]/5 text-ink">
					{mcpConfig(t`your-api-key`)}
				</pre>
			</details>
		</SettingsSection>
	);
}
