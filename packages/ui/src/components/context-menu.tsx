import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import {
	menuItemClassName,
	menuPopupClassName,
	menuSeparatorClassName,
} from "@reactive-resume/ui/components/menu-styles";
import { cn } from "@reactive-resume/utils/style";

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
	return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ className, ...props }: ContextMenuPrimitive.Trigger.Props) {
	return (
		<ContextMenuPrimitive.Trigger
			data-slot="context-menu-trigger"
			className={cn("select-none", className)}
			{...props}
		/>
	);
}

type ContextMenuContentProps = ContextMenuPrimitive.Popup.Props &
	Pick<ContextMenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> & {
		positionerClassName?: string;
	};

function ContextMenuContent({
	align = "start",
	alignOffset = 4,
	side = "inline-end",
	sideOffset = 0,
	className,
	positionerClassName,
	...props
}: ContextMenuContentProps) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Positioner
				className={cn("isolate z-50 outline-none", positionerClassName)}
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<ContextMenuPrimitive.Popup
					data-slot="context-menu-content"
					className={cn(menuPopupClassName, className)}
					{...props}
				/>
			</ContextMenuPrimitive.Positioner>
		</ContextMenuPrimitive.Portal>
	);
}

function ContextMenuItem({
	className,
	inset,
	variant = "default",
	...props
}: ContextMenuPrimitive.Item.Props & {
	inset?: boolean;
	variant?: "default" | "destructive";
}) {
	return (
		<ContextMenuPrimitive.Item
			data-slot="context-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn("group/context-menu-item", menuItemClassName, className)}
			{...props}
		/>
	);
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props) {
	return (
		<ContextMenuPrimitive.Separator
			data-slot="context-menu-separator"
			className={cn(menuSeparatorClassName, className)}
			{...props}
		/>
	);
}

export {
	ContextMenu,
	ContextMenuContent,
	type ContextMenuContentProps,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
};
