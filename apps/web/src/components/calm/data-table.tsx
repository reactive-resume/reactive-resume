import type { AriaRole, ComponentProps } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { rowGroundClassName } from "./list-row";

/*
 * The table is drawn as a grid with subgrid rows, so a column takes the width of its widest cell. Changing `display`
 * makes some browsers forget that these are table elements, so every part states its role again. Spread, because
 * the linter (rightly, for a table that is still displayed as one) removes a role an element already has.
 */
const restate = (role: AriaRole) => ({ role });

type DataTableProps = ComponentProps<"table"> & {
	/** `grid-template-columns` for every row, e.g. `"40px minmax(0,1.1fr) 108px max-content 28px"`. */
	columns: string;
};

/**
 * Calm data table (`.tbl.fit`): a flat list whose rows share columns. No outer box, no stripes, hairlines between
 * rows. Cell text uses `t-row-title` for the name and `t-small text-ink-3` for the quiet line; row actions take
 * `revealOnRowClassName`. Give it an `aria-label`.
 */
export function DataTable({ columns, className, style, ...props }: DataTableProps) {
	return (
		<table
			{...restate("table")}
			data-design="tbl"
			className={cn("grid w-full gap-x-4 text-start", className)}
			style={{ gridTemplateColumns: columns, ...style }}
			{...props}
		/>
	);
}

export function DataTableHead({ className, ...props }: ComponentProps<"thead">) {
	return <thead {...restate("rowgroup")} className={cn("contents", className)} {...props} />;
}

export function DataTableBody({ className, ...props }: ComponentProps<"tbody">) {
	return <tbody {...restate("rowgroup")} className={cn("contents", className)} {...props} />;
}

type DataTableRowProps = ComponentProps<"tr"> & {
	/** `header` is the 32px row of column labels; `group` is a label row that opens a group of rows. */
	variant?: "default" | "header" | "group";
	selected?: boolean;
};

/** A row is at least 56px tall and takes the hover ground; its controls appear on hover and focus. */
export function DataTableRow({ variant = "default", selected = false, className, ...props }: DataTableRowProps) {
	return (
		<tr
			{...restate("row")}
			data-selected={selected || undefined}
			className={cn(
				"col-span-full grid grid-cols-subgrid items-center",
				variant === "header" && "min-h-8 border-b border-line text-xs font-medium text-ink-3",
				variant === "group" && "min-h-11 pt-4 text-sm font-semibold",
				variant === "default" &&
					cn(
						rowGroundClassName,
						"min-h-14 border-b border-line py-2",
						selected ? "border-transparent before:bg-accent-soft" : "hover:border-transparent hover:before:bg-hover",
					),
				className,
			)}
			{...props}
		/>
	);
}

type DataTableHeaderCellProps = ComponentProps<"th"> & {
	/** Marks the sorted column, for people and assistive technology alike. */
	sort?: "ascending" | "descending";
};

/** A column label. One with nothing to show (a checkbox or More column) still needs an `sr-only` name. */
export function DataTableHeaderCell({ sort, className, children, ...props }: DataTableHeaderCellProps) {
	return (
		<th
			{...restate("columnheader")}
			scope="col"
			aria-sort={sort}
			className={cn("flex min-w-0 items-center gap-1 p-0 text-start font-medium", sort && "text-ink-2", className)}
			{...props}
		>
			{children}
			{sort && <Icon name={sort === "ascending" ? "arrow-up" : "arrow-down"} size={14} />}
		</th>
	);
}

type DataTableCellProps = ComponentProps<"td"> & {
	/** The first column names the thing: it is the row's header and holds the link. */
	header?: boolean;
	/** Spans every column, for a `group` row's label. */
	full?: boolean;
};

export function DataTableCell({ header = false, full = false, className, ...props }: DataTableCellProps) {
	const Cell = header ? "th" : "td";
	return (
		<Cell
			{...restate(header ? "rowheader" : "cell")}
			{...(header ? { scope: "row" } : {})}
			className={cn(
				"flex min-w-0 items-center gap-2 p-0 text-start font-[inherit]",
				full && "col-span-full",
				className,
			)}
			{...props}
		/>
	);
}
