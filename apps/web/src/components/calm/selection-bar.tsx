import type { ComponentProps } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";

// Escape belongs to whatever is open on top of the page first.
const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

type SelectionBarProps = Omit<ComponentProps<"div">, "aria-label"> & {
	/** Names what is selected ("Selected documents"). */
	label: string;
	count: number;
	/** How many could be selected. With `onSelectAll`, offers "Select all N" until all are. */
	total?: number;
	onSelectAll?: () => void;
	/** Runs from the close button and from Escape. */
	onClear: () => void;
};

/**
 * Calm selection bar (`.selbar`): floats over the list, bottom centre of the nearest positioned ancestor, from the
 * first tick to the last. Children are its actions: quiet small buttons, with the reversible removal in danger text.
 * The page header does not change while it shows.
 */
export function SelectionBar({
	label,
	count,
	total,
	onSelectAll,
	onClear,
	className,
	children,
	...props
}: SelectionBarProps) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (event.target instanceof Element && event.target.closest(OVERLAYS)) return;
			onClear();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClear]);

	return (
		<div
			role="toolbar"
			aria-label={label}
			data-design="selbar"
			className={cn(
				"absolute start-1/2 bottom-6 z-20 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-line bg-raised py-1.5 ps-2 pe-1.5 whitespace-nowrap shadow-e3 rtl:translate-x-1/2",
				className,
			)}
			{...props}
		>
			<span className="px-2 text-sm font-semibold">
				<Plural value={count} one="# selected" other="# selected" />
			</span>
			{onSelectAll && total !== undefined && count < total && (
				<Button variant="ghost" size="sm" onClick={onSelectAll}>
					<Trans>Select all {total}</Trans>
				</Button>
			)}
			{children && <SelectionBarSeparator />}
			{children}
			<SelectionBarSeparator />
			<IconButton
				icon="x"
				label={t`Clear selection`}
				shortcut="Esc"
				size="icon-xs"
				iconSize={16}
				tooltipSide="top"
				onClick={onClear}
			/>
		</div>
	);
}

/** A hairline between groups of actions in the bar. */
function SelectionBarSeparator() {
	return <span aria-hidden="true" className="m-1 w-px shrink-0 self-stretch bg-line" />;
}
