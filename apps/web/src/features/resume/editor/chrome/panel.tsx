import type { ComponentProps, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";

// What the editor's one panel slot (shell.tsx, `data-design="epanel"`, 400px) lays out the same way whatever is in it:
// 24px sides, 20px above, a serif title with at most one action beside it, and an optional foot pinned to the bottom.

/** The padded column a panel's content sits in. It fills the slot, so a `PanelFoot` rests on the bottom edge. */
export function PanelBody({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex shrink-0 grow flex-col px-6 pt-5", className)} {...props} />;
}

type PanelHeaderProps = {
	/** The way back up, a `Crumb` from `@/components/calm/crumb`. The first panel of a mode has none. */
	crumb?: ReactNode;
	title: ReactNode;
	/** The title has no text yet ("Untitled"): it is drawn quietly. */
	muted?: boolean;
	/** Quiet things right after the title: a Draft badge. The title then keeps to its own width. */
	titleEnd?: ReactNode;
	/** The one action, or a pager, at the end of the title's line. */
	actions?: ReactNode;
	/** The title keeps to its own width and the action sits at the far end (a text action beside a short title). */
	fit?: boolean;
	className?: string;
};

/** A panel's title line: the 28px serif `h2`, under its crumb when the panel was reached from another. */
export function PanelHeader({
	crumb,
	title,
	muted = false,
	titleEnd,
	actions,
	fit = false,
	className,
}: PanelHeaderProps) {
	const grow = !fit && !titleEnd;

	return (
		<header className={cn("flex flex-col items-start", className)}>
			{crumb}
			<div className={cn("flex w-full items-center gap-2", crumb ? "mt-0.5" : undefined)}>
				<h2 dir="auto" className={cn("min-w-0 truncate t-page-title", grow && "flex-1", muted && "text-ink-3")}>
					{title}
				</h2>
				{titleEnd}
				{!grow && <span className="flex-1" />}
				{actions}
			</div>
		</header>
	);
}

/** The quiet line at the foot of a panel; it stays on the bottom edge while the content is short. */
export function PanelFoot({ className, ...props }: ComponentProps<"p">) {
	return <p className={cn("mt-auto flex gap-2 pt-4 pb-5 t-small text-ink-3", className)} {...props} />;
}

type PanelTakeoverProps = {
	title: ReactNode;
	/** Closes it and hands the slot back to the mode's panel. */
	onClose: () => void;
	children: ReactNode;
};

/**
 * Something that takes the panel's place and brings no header of its own (History): a title, a close button and a
 * scrolling body. The assistant draws its own header and does not use this.
 */
export function PanelTakeover({ title, onClose, children }: PanelTakeoverProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-5 pb-6 [overflow-anchor:none]">
			<PanelHeader
				title={title}
				actions={<IconButton icon="x" label={t`Close`} size="icon-sm" className="-me-1.5" onClick={onClose} />}
			/>
			<div className="mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
		</div>
	);
}
