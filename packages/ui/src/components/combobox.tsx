import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { InputGroup, InputGroupButton, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { popupSlideClassName } from "@reactive-resume/ui/components/menu-styles";
import { cn } from "@reactive-resume/utils/style";

const ComboboxRoot = ComboboxPrimitive.Root;
const ComboboxGroup = ComboboxPrimitive.Group;
const ComboboxGroupLabel = ComboboxPrimitive.GroupLabel;

const useFilter = ComboboxPrimitive.useFilter;

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
	return <ComboboxPrimitive.Value data-slot="combobox-value" {...props} />;
}

type ComboboxTriggerProps = ComboboxPrimitive.Trigger.Props & {
	/** `up-down` (default) for a searchable picker; `down` where the boards draw a plain select-like field. */
	caret?: "up-down" | "down";
};

function ComboboxTrigger({ className, children, caret = "up-down", ...props }: ComboboxTriggerProps) {
	return (
		<ComboboxPrimitive.Trigger
			data-slot="combobox-trigger"
			className={cn("[--icon-size:18px] [&_svg:not([class*='size-'])]:size-4", className)}
			{...props}
		>
			{children}
			<Icon name={caret === "down" ? "caret-down" : "caret-up-down"} className="pointer-events-none text-ink-3" />
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
			<Icon name="x" size={18} className="pointer-events-none" />
		</ComboboxPrimitive.Clear>
	);
}

function ComboboxInput({ className, children, disabled = false, ...props }: ComboboxPrimitive.Input.Props) {
	return (
		<InputGroup className={cn("w-auto", className)}>
			<ComboboxPrimitive.Input render={<InputGroupInput disabled={disabled} />} {...props} />
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
						"group/combobox-content relative max-h-(--available-height) w-fit max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-lg border border-line bg-raised text-ink shadow-e2 transition-[opacity,scale,translate] duration-standard ease-enter data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-[chips=true]:min-w-(--anchor-width) *:data-[slot=input-group]:h-11 *:data-[slot=input-group]:rounded-none *:data-[slot=input-group]:border-0 *:data-[slot=input-group]:border-b *:data-[slot=input-group]:border-line *:data-[slot=input-group]:bg-transparent *:data-[slot=input-group]:shadow-none",
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
				"relative flex min-h-[34px] w-full cursor-default items-center gap-2.5 rounded-sm ps-2.5 pe-9 text-sm leading-5 text-ink outline-hidden select-none [--icon-size:18px] data-highlighted:bg-hover data-selected:font-medium data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<ComboboxPrimitive.ItemIndicator
				render={<span className="pointer-events-none absolute inset-e-2.5 flex items-center justify-center" />}
			>
				<Icon name="check" className="pointer-events-none text-ink" />
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

export {
	ComboboxClear,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxGroup,
	ComboboxGroupLabel,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxRoot,
	ComboboxTrigger,
	ComboboxValue,
	useFilter,
};
