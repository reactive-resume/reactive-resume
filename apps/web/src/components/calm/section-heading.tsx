import type { ComponentProps, ReactNode } from "react";
import { cn } from "@reactive-resume/utils/style";

type SectionHeadingProps = ComponentProps<"h2"> & {
	/** Directly under a page header: 8px above instead of 32. */
	first?: boolean;
	/** A small useful note after the title: a count, a source, a date. */
	note?: ReactNode;
	/** At most one text action ("See all", "Add"): pass a link or a plain button, never a `Button`. */
	action?: ReactNode;
};

/** Calm section heading (`.sh`): a 22px serif `h2` that opens a group of rows, with 32px of space above it. */
export function SectionHeading({ first = false, note, action, className, children, ...props }: SectionHeadingProps) {
	return (
		<h2 className={cn("flex items-baseline gap-3 pb-2 t-section-title", first ? "pt-2" : "pt-8", className)} {...props}>
			{children}
			{note != null && <small className="font-sans text-[13px]/[18px] text-ink-3">{note}</small>}
			{action && <span className="ms-auto font-sans text-sm font-medium text-accent-text">{action}</span>}
		</h2>
	);
}
