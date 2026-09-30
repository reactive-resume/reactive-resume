import type * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@reactive-resume/utils/style";

/** Shared by text inputs and textareas: focus is an accent border plus a soft 3px ring. */
const inputBaseClassName =
	"w-full min-w-0 rounded-md border border-line-2 bg-raised text-ink text-sm outline-none transition-[border-color,box-shadow] duration-quick placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 aria-invalid:border-danger aria-invalid:focus:shadow-[0_0_0_3px_var(--danger-soft)]";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				inputBaseClassName,
				"h-9 px-3 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-ink pointer-coarse:h-11",
				className,
			)}
			{...props}
		/>
	);
}

export { Input, inputBaseClassName };
