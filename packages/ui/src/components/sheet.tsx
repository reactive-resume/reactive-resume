import type * as React from "react";
import { Drawer as SheetPrimitive } from "@base-ui/react/drawer";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
	return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
	return (
		<SheetPrimitive.Backdrop
			data-slot="sheet-overlay"
			className={cn(
				"fixed inset-0 z-50 bg-(--scrim-sheet) transition-opacity duration-emphasized ease-enter data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d3)*0.7)] data-starting-style:opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

type SheetContentProps = SheetPrimitive.Popup.Props & {
	side?: "top" | "right" | "bottom" | "left";
	showCloseButton?: boolean;
	/** Accessible name of the close button; pass a translated string. */
	closeLabel?: string;
};

/**
 * A task beside the page. Side sheets slide in from their edge over 320ms; the bottom variant is the mobile
 * form (18px top radius and a grabber) and follows a downward swipe: a flick or a drag past half its height
 * dismisses it, anything less settles back.
 */
function SheetContent({
	className,
	children,
	side = "right",
	showCloseButton = true,
	closeLabel = "Close",
	...props
}: SheetContentProps) {
	const popup = (
		<SheetPrimitive.Popup
			data-slot="sheet-content"
			data-side={side}
			className={cn(
				"pointer-events-auto fixed z-50 flex flex-col gap-4 bg-raised text-sm text-ink shadow-e3 transition-[translate] duration-emphasized ease-enter outline-none data-ending-style:duration-[calc(var(--d3)*0.7)]",
				"data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-full data-[side=left]:data-ending-style:-translate-x-full data-[side=left]:data-starting-style:-translate-x-full data-[side=left]:sm:max-w-[440px]",
				"data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-full data-[side=right]:data-ending-style:translate-x-full data-[side=right]:data-starting-style:translate-x-full data-[side=right]:sm:max-w-[440px]",
				"rtl:data-[side=left]:data-ending-style:translate-x-full rtl:data-[side=left]:data-starting-style:translate-x-full rtl:data-[side=right]:data-ending-style:-translate-x-full rtl:data-[side=right]:data-starting-style:-translate-x-full",
				"data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:data-ending-style:-translate-y-full data-[side=top]:data-starting-style:-translate-y-full",
				"data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[calc(100svh-2rem)] data-[side=bottom]:rounded-t-3xl data-[side=bottom]:pt-3 data-[side=bottom]:data-ending-style:translate-y-full data-[side=bottom]:data-starting-style:translate-y-full",
				// Swipe: Base UI moves the popup inline while dragging; on release it rests at the swipe offset and
				// transitions back to 0, or leaves on the drawer curve, faster for a harder flick.
				"data-swipe-dismiss:data-ending-style:duration-[calc(var(--d3)*0.7*var(--drawer-swipe-strength,1))] data-swipe-dismiss:data-ending-style:ease-drawer data-swiping:select-none data-[side=bottom]:[transform:translateY(var(--drawer-swipe-movement-y,0px))] data-[side=bottom]:transition-[translate,transform]",
				className,
			)}
			{...props}
		>
			{side === "bottom" && (
				<span aria-hidden="true" className="mx-auto block h-[5px] w-9 shrink-0 rounded-full bg-line-2" />
			)}
			{/* Content is where a mouse press clicks rather than starts a swipe; `contents` keeps it out of the layout. */}
			<SheetPrimitive.Content className="contents">{children}</SheetPrimitive.Content>
			{showCloseButton && (
				<SheetPrimitive.Close
					data-slot="sheet-close"
					aria-label={closeLabel}
					render={<Button variant="ghost" className="absolute inset-e-3 top-3 text-ink-2" size="icon" />}
				>
					<Icon name="close" />
				</SheetPrimitive.Close>
			)}
		</SheetPrimitive.Popup>
	);

	return (
		<SheetPortal>
			<SheetOverlay />
			{/* The viewport tracks swipes; clicks outside the popup fall through to the backdrop. */}
			<SheetPrimitive.Viewport data-slot="sheet-viewport" className="pointer-events-none fixed inset-0 z-50">
				{popup}
			</SheetPrimitive.Viewport>
		</SheetPortal>
	);
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="sheet-header" className={cn("flex flex-col gap-1 px-6 pe-14 pt-5", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 p-6", className)} {...props} />;
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn("font-display text-[22px] leading-7 font-medium text-ink", className)}
			{...props}
		/>
	);
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
	return (
		<SheetPrimitive.Description
			data-slot="sheet-description"
			className={cn("text-sm text-ink-2", className)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetClose,
	SheetContent,
	type SheetContentProps,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
};
