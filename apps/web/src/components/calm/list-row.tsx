import type { ComponentProps, ReactNode } from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

/** Row actions show on hover and on keyboard focus inside the row; touch screens always show them. */
export const revealOnRowClassName =
	"opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100";

/**
 * For a row that holds its own controls: keep the row a `div` and put this on the title's link, so the whole row is
 * still the click target without nesting buttons inside a link.
 */
export const rowLinkClassName = "after:absolute after:-inset-x-3 after:inset-y-0";

/** The hover ground of rows: it bleeds 12px past the text on both sides, so the hairlines stay on the text edge. */
export const rowGroundClassName =
	"group/row relative isolate before:absolute before:-inset-x-3 before:inset-y-0 before:-z-10 before:rounded-md";

type ListProps = ComponentProps<"div"> & {
	/** A hairline above the first row too. */
	cap?: boolean;
	/** 44px rows with 14px titles, for panels, sheets and dialogs. */
	tight?: boolean;
};

/** Calm flat list (`.ls`): rows sit on the page, divided by hairlines, with no outer box. */
export function List({ cap = false, tight = false, className, ...props }: ListProps) {
	return (
		<div
			data-slot="list"
			data-cap={cap || undefined}
			data-tight={tight || undefined}
			className={cn("group/list flex flex-col", className)}
			{...props}
		/>
	);
}

type ListRowProps = Omit<useRender.ComponentProps<"div">, "title"> & {
	/** Icon tile, document thumbnail, initials, date column or stage dot. */
	leading?: ReactNode;
	title?: ReactNode;
	/** The one quiet line under the title. Never a third. */
	subtitle?: ReactNode;
	/** A quiet value before the trailing element. */
	value?: ReactNode;
	/** The one thing at the end: a badge, a switch, a text action. */
	trailing?: ReactNode;
	/** Controls that appear on hover and focus. They must also be in the row's menu. */
	actions?: ReactNode;
	/** A caret at the end: the row opens something. */
	caret?: boolean;
	/** The hover ground. On by default when the row renders as a link or button. */
	interactive?: boolean;
	selected?: boolean;
	/** `danger` for a reversible removal, `dim` for something set aside. */
	variant?: "default" | "danger" | "dim";
};

/**
 * Calm list row (`.li`): one idea on one line, at least 56px tall. Pass `render` to make the whole row a router
 * `Link` or a `button`; with `actions`, keep it a `div` and give the title's link `rowLinkClassName`.
 */
export function ListRow({
	leading,
	title,
	subtitle,
	value,
	trailing,
	actions,
	caret = false,
	interactive,
	selected = false,
	variant = "default",
	className,
	render,
	children,
	...props
}: ListRowProps) {
	const hasGround = interactive ?? !!render;
	const slot = { "data-slot": "list-row", "data-selected": selected || undefined };

	return useRender({
		defaultTagName: "div",
		render,
		props: mergeProps<"div">(
			{
				className: cn(
					rowGroundClassName,
					"flex min-h-(--row) items-center gap-3.5 border-b border-line py-2.5 text-start group-data-tight/list:min-h-11 group-data-tight/list:gap-3 group-data-tight/list:py-1.5 group-data-cap/list:first:border-t last:border-b-0",
					hasGround && "hover:border-transparent hover:before:bg-hover",
					selected && "border-transparent before:bg-accent-soft hover:before:bg-accent-soft",
					className,
				),
				children: (
					<>
						{leading}
						{(title || subtitle) && (
							<span className="flex min-w-0 flex-1 flex-col gap-px">
								{title && (
									<span
										className={cn(
											"truncate text-[15px]/[22px] font-medium group-data-tight/list:text-sm/5",
											variant === "danger" ? "text-danger-text" : variant === "dim" ? "text-ink-3" : "text-ink",
										)}
									>
										{title}
									</span>
								)}
								{subtitle && <span className="truncate text-[13px]/[18px] text-ink-3">{subtitle}</span>}
							</span>
						)}
						{children}
						{actions && (
							<span className={cn("relative z-10 flex shrink-0 items-center gap-1", revealOnRowClassName)}>
								{actions}
							</span>
						)}
						{value && <span className="flex shrink-0 items-center gap-1.5 text-[13px]/[18px] text-ink-3">{value}</span>}
						{trailing && <span className="relative z-10 flex shrink-0 items-center">{trailing}</span>}
						{caret && <Icon name="caret-right" size={18} className="text-ink-3" />}
					</>
				),
			},
			{ ...props, ...slot },
		),
	});
}

type IconTileProps = ComponentProps<"span"> & { accent?: boolean };

/** Calm leading tile (`.ic40`): a 40px sunken square for an icon or initials at the start of a row. */
export function IconTile({ accent = false, className, ...props }: IconTileProps) {
	return (
		<span
			className={cn(
				"flex size-10 shrink-0 items-center justify-center rounded-md text-sm/4 font-semibold",
				accent ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-2",
				className,
			)}
			{...props}
		/>
	);
}

type DateColumnProps = Omit<ComponentProps<"span">, "children"> & {
	/** The day of the month, already formatted for the locale. */
	day: ReactNode;
	/** The short month or weekday under it. */
	label: ReactNode;
};

/** Calm date column (`.datecol`): a serif day over a short month, 40px wide, at the start of a row. */
export function DateColumn({ day, label, className, ...props }: DateColumnProps) {
	return (
		<span className={cn("flex w-10 shrink-0 flex-col items-center", className)} {...props}>
			<span className="font-display text-[22px]/[26px]">{day}</span>
			<span className="text-xs font-medium text-ink-3">{label}</span>
		</span>
	);
}
