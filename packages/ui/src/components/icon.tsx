import type { IconName } from "../icons/names";
import type * as React from "react";
import { cn } from "@reactive-resume/utils/style";

// Icons that point somewhere are mirrored in right-to-left layouts.
const DIRECTIONAL_ICONS = new Set<IconName>([
	"arrow_back",
	"arrow_forward",
	"chevron_left",
	"chevron_right",
	"redo",
	"undo",
]);

type IconProps = Omit<React.ComponentProps<"span">, "children"> & {
	name: IconName;
	/** The filled glyph. The design system reserves it for the selected navigation item. */
	filled?: boolean | undefined;
	/** Glyph size in CSS pixels: 20 on desktop, 24 on touch. */
	size?: number | undefined;
};

/**
 * A Material Symbols Rounded glyph (weight 300), drawn from `data-icon` by CSS so the name never becomes text.
 * Icons are decorative: the control they sit in carries the accessible name.
 */
function Icon({ name, filled = false, size = 20, className, style, ...props }: IconProps) {
	return (
		<span
			aria-hidden="true"
			translate="no"
			data-slot="icon"
			{...props}
			// After the props: `data-icon` is the glyph, so a stray one never blanks it.
			data-icon={name}
			className={cn("material-symbol", DIRECTIONAL_ICONS.has(name) && "rtl:-scale-x-100", className)}
			style={{
				fontSize: size,
				fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" 300, "GRAD" 0, "opsz" ${size >= 24 ? 24 : 20}`,
				...style,
			}}
		/>
	);
}

export { Icon, type IconName, type IconProps };
