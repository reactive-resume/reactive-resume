import type { ReactNode } from "react";
import { cn } from "@reactive-resume/utils/style";

export type EmptyStateProps = {
	title: ReactNode;
	description?: ReactNode;
	/** Notices and other explanatory content, stacked above the actions. */
	children?: ReactNode;
	/** The one thing to do next; use the secondary slot for a quieter alternative. */
	action?: ReactNode;
	secondary?: ReactNode;
	/** A compact row for the absence inside a list, instead of the full dashed card. */
	variant?: "default" | "compact";
	className?: string;
};

/**
 * The same "nothing here yet" moment in every module: a dashed card with a serif headline, one sentence and one
 * action, or one quiet 13px line inside a list or under a section heading.
 */
export function EmptyState({
	title,
	description,
	children,
	action,
	secondary,
	variant = "default",
	className,
}: EmptyStateProps) {
	const compact = variant === "compact";
	const Title = compact ? "p" : "h2";

	return (
		<div
			data-slot="empty-state"
			data-design={compact ? undefined : "empty"}
			data-variant={variant}
			className={cn(
				compact
					? "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
					: "grid justify-items-center gap-2 rounded-xl border border-dashed border-line-2 px-6 py-8 text-center",
				className,
			)}
		>
			<div className={cn("grid", compact ? "min-w-0 gap-px" : "justify-items-center gap-2")}>
				<Title
					className={cn(
						compact ? "text-[13px] leading-[18px] text-ink-3" : "font-display text-[22px] leading-7 text-ink",
					)}
				>
					{title}
				</Title>
				{description && (
					<p
						className={compact ? "text-[13px] leading-[18px] text-ink-3" : "max-w-[340px] text-sm leading-5 text-ink-2"}
					>
						{description}
					</p>
				)}
			</div>
			{children && (
				<div className={cn("grid w-full justify-items-center gap-3", compact && "justify-items-start")}>{children}</div>
			)}
			{(action || secondary) && (
				<div className={cn("flex flex-wrap items-center gap-2", !compact && "mt-2 justify-center")}>
					{action}
					{secondary}
				</div>
			)}
		</div>
	);
}
