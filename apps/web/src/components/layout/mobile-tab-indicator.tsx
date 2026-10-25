import { m } from "motion/react";
import { TAB_SPRING } from "@/libs/motion";

/**
 * The phone tab bar's marker: a short accent bar on the active tab's top edge. Render it inside the active tab
 * (which must be `relative`); when another tab becomes active it springs across to it. Reduced motion moves it at
 * once (see `followReducedMotion`).
 */
export function MobileTabIndicator() {
	return (
		<m.span
			aria-hidden="true"
			layoutId="mobile-tab-indicator"
			transition={TAB_SPRING}
			className="absolute inset-x-0 -top-px mx-auto h-0.5 w-8 rounded-sm bg-accent"
		/>
	);
}
