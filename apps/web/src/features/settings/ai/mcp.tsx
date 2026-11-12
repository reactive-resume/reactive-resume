import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Swap } from "@reactive-resume/ui/components/swap";
import { SettingsSection } from "../section";

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
			<div className="flex items-center gap-2 max-sm:flex-wrap">
				<span className="flex h-10 min-w-0 flex-1 items-center truncate rounded-md bg-raised px-3 font-mono text-[13px]/4 font-medium shadow-[inset_0_0_0_1px_var(--control-border)] max-sm:basis-full">
					{address}
				</span>
				<Button
					variant="secondary"
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
				<Button
					variant="ghost"
					nativeButton={false}
					render={
						<a href="https://docs.rxresu.me/guides/using-the-mcp-server" target="_blank" rel="noopener noreferrer" />
					}
				>
					<Trans>Setup guide</Trans>
					<Icon name="arrow-square-out" size={16} />
				</Button>
			</div>
		</SettingsSection>
	);
}
