import type * as React from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { inputBaseClassName } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";

type NativeSelectProps = React.ComponentProps<"select"> & { caret?: "down" | "up-down" };

/** The platform select, restyled like an input, with a 18px chevron at the end. */
function NativeSelect({ className, children, caret = "down", ...props }: NativeSelectProps) {
	return (
		<div data-slot="native-select" className="relative inline-flex w-full">
			<select
				className={cn(
					inputBaseClassName,
					"h-10 cursor-pointer appearance-none ps-[11px] pe-9 pointer-coarse:h-11",
					className,
				)}
				{...props}
			>
				{children}
			</select>
			<Icon
				name={caret === "up-down" ? "caret-up-down" : "caret-down"}
				size={18}
				className="pointer-events-none absolute inset-e-2.5 top-1/2 -translate-y-1/2 text-ink-3"
			/>
		</div>
	);
}

export { NativeSelect };
