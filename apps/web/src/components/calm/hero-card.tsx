import type { ComponentProps, ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";

/**
 * True when the action buttons, at their own widths, don't fit one line: they then stack, each the full width, the
 * accent first. Widths are read while the buttons are in a line and kept while stacked.
 */
// ponytail: widths measured in line are reused while stacked; a label change while stacked re-measures only on unstack.
function useStacked() {
	const ref = useRef<HTMLDivElement>(null);
	const widths = useRef(0);
	const [stacked, setStacked] = useState(false);
	useLayoutEffect(() => {
		const row = ref.current;
		if (!row) return;
		const measure = () => {
			const items = [...row.children] as HTMLElement[];
			if (items.length < 2) return setStacked(false);
			if (row.dataset.stacked === undefined) {
				const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
				widths.current = items.reduce((sum, item) => sum + item.offsetWidth, gap * (items.length - 1));
			}
			setStacked(widths.current > row.clientWidth + 0.5);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(row);
		return () => observer.disconnect();
	}, []);
	return [ref, stacked] as const;
}

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
	const [actionsRef, stacked] = useStacked();
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
				<div
					ref={actionsRef}
					data-stacked={stacked || undefined}
					className={cn(
						"flex flex-wrap items-center gap-2 data-stacked:flex-col data-stacked:items-stretch",
						wide || leading ? "max-sm:mt-3" : "mt-3",
					)}
				>
					{actions}
				</div>
			)}
		</section>
	);
}
