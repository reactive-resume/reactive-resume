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

/** The same "nothing here yet" moment in every module: a dashed card, or a compact row inside a list. */
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
			data-variant={variant}
			className={cn(
				compact
					? "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3"
					: "grid justify-items-center gap-2 rounded-xl border border-dashed border-line-2 p-7 text-center",
				className,
			)}
		>
			<div className={cn("grid gap-1", compact ? "min-w-0" : "justify-items-center")}>
				<Title
					className={cn(
						compact ? "text-[13px] leading-[19px] text-ink" : "font-display text-[22px] leading-7 font-medium",
					)}
				>
					{title}
				</Title>
				{description && (
					<p className={compact ? "text-[13px] leading-[19px] text-ink-2" : "max-w-[340px] text-sm text-ink-2"}>
						{description}
					</p>
				)}
			</div>
			{children && (
				<div className={cn("grid w-full justify-items-center gap-3", compact && "justify-items-start")}>{children}</div>
			)}
			{(action || secondary) && (
				<div className={cn("flex flex-wrap items-center gap-2", !compact && "justify-center")}>
					{action}
					{secondary}
				</div>
			)}
		</div>
	);
}
