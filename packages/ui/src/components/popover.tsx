import type * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { popupSlideClassName } from "@reactive-resume/ui/components/menu-styles";
import { cn } from "@reactive-resume/utils/style";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	className,
	align = "center",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
				className="isolate z-50"
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						"z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-xl bg-raised p-3 text-sm text-ink shadow-e2 outline-hidden transition-[opacity,scale,translate] duration-standard ease-enter data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-instant:transition-none data-starting-style:scale-[0.98] data-starting-style:opacity-0",
						popupSlideClassName,
						className,
					)}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="popover-header" className={cn("flex flex-col gap-0.5 text-sm", className)} {...props} />;
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
	return (
		<PopoverPrimitive.Title data-slot="popover-title" className={cn("font-semibold text-ink", className)} {...props} />
	);
}

export { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger };
