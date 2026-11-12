import type { ComponentProps, ReactNode } from "react";
import { cn } from "@reactive-resume/utils/style";

type HeroCardProps = Omit<ComponentProps<"section">, "title"> & {
	/** The quiet context line: when, and in which stage (a `StageDot` fits here). */
	kicker?: ReactNode;
	/** What is happening, in one 20px line. */
	title: ReactNode;
	/** The page's one accent button; a second action is ghost. */
	actions?: ReactNode;
	/** Text and action side by side, for a single-line prompt. */
	wide?: boolean;
	/** A tile before the text (a company monogram); the hero then lays out as a row from 640 up. */
	leading?: ReactNode;
};

/** Calm hero card (`.hero`): the single most important next step on a page. One per page; never nest a card in it. */
export function HeroCard({
	kicker,
	title,
	actions,
	wide = false,
	leading,
	className,
	children,
	...props
}: HeroCardProps) {
	return (
		<section
			data-design="hero"
			className={cn(
				"flex flex-col gap-2 rounded-xl border border-line bg-surface p-5 shadow-e1 sm:p-6",
				(wide || leading) && "sm:flex-row sm:items-center sm:gap-x-4",
				wide && "sm:gap-6",
				className,
			)}
			{...props}
		>
			{leading && <div className="shrink-0 max-sm:hidden">{leading}</div>}
			<div className={cn("flex min-w-0 flex-col gap-2", (wide || leading) && "flex-1")}>
				{kicker && (
					<p className="flex flex-wrap items-center gap-2 text-[13px]/[18px] font-medium text-ink-3">{kicker}</p>
				)}
				<h2 className="t-heading">{title}</h2>
				{children && <p className="max-w-[60ch] t-body text-ink-2">{children}</p>}
			</div>
			{actions && (
				<div className={cn("flex flex-wrap items-center gap-2", wide || leading ? "max-sm:mt-3" : "mt-3")}>
					{actions}
				</div>
			)}
		</section>
	);
}
