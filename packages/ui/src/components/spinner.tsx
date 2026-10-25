import type * as React from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

type SpinnerProps = React.ComponentProps<"span"> & {
	/** Hide it from assistive tech when the surrounding control already says it's busy. */
	decorative?: boolean;
};

/**
 * The app's one loader: a 14px circle-notch turning once a second. Size it with `size-*`; it takes the text color.
 * It keeps turning under reduced motion (globals.css exempts it), because a frozen loader looks like a hung app.
 * Pair it with text that says what's happening.
 */
function Spinner({ className, decorative = false, ...props }: SpinnerProps) {
	const semantics = decorative
		? ({ "aria-hidden": true } as const)
		: ({ role: "status", "aria-label": "Loading" } as const);

	return (
		<span {...semantics} data-slot="spinner" className={cn("inline-flex size-3.5 shrink-0", className)} {...props}>
			<Icon name="circle-notch" className="size-full animate-spin" />
		</span>
	);
}

export { Spinner, type SpinnerProps };
