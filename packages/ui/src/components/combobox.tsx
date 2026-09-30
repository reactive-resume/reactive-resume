import type * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { Icon } from "@reactive-resume/ui/components/icon";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@reactive-resume/ui/components/input-group";
import { menuSeparatorClassName, popupSlideClassName } from "@reactive-resume/ui/components/menu-styles";
import { cn } from "@reactive-resume/utils/style";

const ComboboxRoot = ComboboxPrimitive.Root;

const useFilter = ComboboxPrimitive.useFilter;

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
	return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
	return (
		<ComboboxPrimitive.Trigger
			data-slot="combobox-trigger"
			className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
			{...props}
		>
			{children}
			<Icon name="expand_more" className="pointer-events-none text-ink-3" />
		</ComboboxPrimitive.Trigger>
	);
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
	return (
		<ComboboxPrimitive.Clear
			data-slot="combobox-clear"
			render={<InputGroupButton variant="ghost" size="icon-xs" />}
			className={cn(className)}
			{...props}
		>
			<Icon name="close" size={18} className="pointer-events-none" />
		</ComboboxPrimitive.Clear>
	);
}

function ComboboxInput({
	className,
	children,
	disabled = false,
	showTrigger = true,
	showClear = false,
	...props
}: ComboboxPrimitive.Input.Props & {
	showTrigger?: boolean;
	showClear?: boolean;
}) {
	return (
		<InputGroup className={cn("w-auto", className)}>
			<ComboboxPrimitive.Input render={<InputGroupInput disabled={disabled} />} {...props} />
			{(showTrigger || showClear) && (
				<InputGroupAddon align="inline-end">
					{showTrigger && (
						<InputGroupButton
							size="icon-xs"
							variant="ghost"
							render={<ComboboxTrigger />}
							data-slot="input-group-button"
							className="group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent"
							disabled={disabled}
						/>
					)}
					{showClear && <ComboboxClear disabled={disabled} />}
				</InputGroupAddon>
			)}
			{children}
		</InputGroup>
	);
}

function ComboboxContent({
	className,
	side = "bottom",
	sideOffset = 6,
	align = "start",
	alignOffset = 0,
	anchor,
	...props
}: ComboboxPrimitive.Popup.Props &
	Pick<ComboboxPrimitive.Positioner.Props, "side" | "align" | "sideOffset" | "alignOffset" | "anchor">) {
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Positioner
				side={side}
				sideOffset={sideOffset}
				align={align}
				alignOffset={alignOffset}
				anchor={anchor}
				className="isolate z-50"
			>
				<ComboboxPrimitive.Popup
					data-slot="combobox-content"
					data-chips={!!anchor}
					className={cn(
						"group/combobox-content relative max-h-(--available-height) w-fit max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-xl bg-raised text-ink shadow-e2 transition-[opacity,scale,translate] duration-standard ease-enter data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-[chips=true]:min-w-(--anchor-width) *:data-[slot=input-group]:m-1 *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-9 *:data-[slot=input-group]:bg-bg *:data-[slot=input-group]:shadow-none",
						popupSlideClassName,
						className,
					)}
					{...props}
				/>
			</ComboboxPrimitive.Positioner>
		</ComboboxPrimitive.Portal>
	);
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
	return (
		<ComboboxPrimitive.List
			data-slot="combobox-list"
			className={cn(
				"no-scrollbar max-h-[min(calc(--spacing(72)---spacing(9)),calc(var(--available-height)---spacing(9)))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
	return (
		<ComboboxPrimitive.Item
			data-slot="combobox-item"
			className={cn(
				"relative flex min-h-9 w-full cursor-default items-center gap-2.5 rounded-md ps-2.5 pe-9 text-sm text-ink outline-hidden select-none data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:text-ink-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<ComboboxPrimitive.ItemIndicator
				render={<span className="pointer-events-none absolute inset-e-2.5 flex items-center justify-center" />}
			>
				<Icon name="check" className="pointer-events-none text-accent-text" />
			</ComboboxPrimitive.ItemIndicator>
		</ComboboxPrimitive.Item>
	);
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
	return (
		<ComboboxPrimitive.Empty
			data-slot="combobox-empty"
			className={cn(
				"hidden w-full justify-center py-3 text-center text-sm text-ink-3 group-data-empty/combobox-content:flex",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
	return (
		<ComboboxPrimitive.Separator
			data-slot="combobox-separator"
			className={cn(menuSeparatorClassName, className)}
			{...props}
		/>
	);
}

function ComboboxChips({
	className,
	...props
}: React.ComponentPropsWithRef<typeof ComboboxPrimitive.Chips> & ComboboxPrimitive.Chips.Props) {
	return (
		<ComboboxPrimitive.Chips
			data-slot="combobox-chips"
			className={cn(
				"flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-line-2 bg-raised px-2.5 py-1 text-sm text-ink transition-[border-color,box-shadow] duration-quick focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)] has-aria-invalid:border-danger has-data-[slot=combobox-chip]:px-1",
				className,
			)}
			{...props}
		/>
	);
}

function ComboboxChipsInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
	return (
		<ComboboxPrimitive.Input
			data-slot="combobox-chip-input"
			className={cn("min-w-16 flex-1 outline-none", className)}
			{...props}
		/>
	);
}

export {
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxClear,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxRoot,
	ComboboxSeparator,
	ComboboxTrigger,
	ComboboxValue,
	useFilter,
};
