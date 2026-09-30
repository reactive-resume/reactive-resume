import type * as React from "react";
import { cn } from "@reactive-resume/utils/style";

/** Field labels sit above their control: 12px, medium weight, secondary ink. */
function Label({ className, htmlFor, ...props }: React.ComponentProps<"label">) {
	return (
		// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- label is a generic component
		<label
			htmlFor={htmlFor}
			data-slot="label"
			className={cn(
				"flex items-center gap-2 text-xs leading-4 font-medium text-ink-2 select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-ink-3 peer-disabled:cursor-not-allowed peer-disabled:text-ink-3",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
