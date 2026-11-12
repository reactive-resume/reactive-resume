import type { ComponentProps, ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

type SetUpAiLineProps = ComponentProps<"div"> & {
	/** What needs AI, as a sentence ("A fit check needs AI."). */
	lead: ReactNode;
	/** Opens the one Set up AI dialog over the page. */
	onSetUp: () => void;
};

/**
 * Calm Set up AI line (`.ailine`): the first row under the title of a screen that needs AI and has none. The lead
 * says what needs AI; the children say what works without it. AI-only buttons are left out of the page, not greyed.
 */
export function SetUpAiLine({ lead, onSetUp, className, children, ...props }: SetUpAiLineProps) {
	return (
		<div
			role="note"
			data-design="ailine"
			className={cn(
				"@container flex items-center gap-3 rounded-lg bg-sunken py-2.5 ps-3.5 pe-2.5 text-[13px]/[18px] text-ink-2",
				className,
			)}
			{...props}
		>
			<Icon name="sparkle" size={18} className="text-ink-3" />
			<p className="min-w-0 flex-1">
				<b className="font-semibold text-ink @max-[400px]:block">{lead}</b> {children}
			</p>
			<Button variant="secondary" size="sm" onClick={onSetUp}>
				<Trans>Set up AI</Trans>
			</Button>
		</div>
	);
}
