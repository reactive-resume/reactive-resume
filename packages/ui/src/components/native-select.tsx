import type * as React from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { inputBaseClassName } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";

/** The platform select, restyled like an input, with a 20px chevron at the end. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
	return (
		<div data-slot="native-select" className="relative inline-flex w-full">
			<select
				className={cn(
					inputBaseClassName,
					"h-9 cursor-pointer appearance-none ps-3 pe-9 pointer-coarse:h-11",
					className,
				)}
				{...props}
			>
				{children}
			</select>
			<Icon
				name="expand_more"
				className="pointer-events-none absolute inset-e-2.5 top-1/2 -translate-y-1/2 text-ink-3"
			/>
		</div>
	);
}

export { NativeSelect };
