import type { ButtonProps } from "@reactive-resume/ui/components/button";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { formatShortcut, Kbd } from "@reactive-resume/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";

type IconButtonProps = Omit<ButtonProps, "children" | "aria-label"> & {
	icon: IconName;
	/** Accessible name, also shown in the tooltip. */
	label: string;
	/** Keyboard shortcut shown in the tooltip, e.g. "⌘Z". */
	shortcut?: string;
	iconSize?: number;
	tooltipSide?: "top" | "bottom" | "left" | "right";
};

/** Icon-only buttons (back, close, more, undo, history, assistant, zoom) always carry a name and a tooltip. */
function IconButton({
	icon,
	label,
	shortcut,
	iconSize,
	tooltipSide = "bottom",
	variant = "ghost",
	size = "icon",
	...props
}: IconButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger render={<Button variant={variant} size={size} aria-label={label} {...props} />}>
				<Icon name={icon} size={iconSize} />
			</TooltipTrigger>
			<TooltipContent side={tooltipSide}>
				{label}
				{shortcut && <Kbd>{formatShortcut(shortcut)}</Kbd>}
			</TooltipContent>
		</Tooltip>
	);
}

export { IconButton, type IconButtonProps };
