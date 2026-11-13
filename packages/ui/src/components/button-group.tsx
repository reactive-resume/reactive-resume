import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import { cn } from "@reactive-resume/utils/style";

/**
 * Buttons joined into one control. Two accent buttons make a SplitButton: a 1px rule in the page colour parts them.
 * Outlined buttons overlap by their 1px edge instead.
 */
const buttonGroupVariants = cva(
	"flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 *:active:scale-100! has-[>[data-slot=button-group]]:gap-2 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-e-md [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
	{
		variants: {
			orientation: {
				horizontal:
					"*:data-slot:rounded-e-none [&>[data-slot=button]:not([class*=shadow-])~[data-slot=button]:not([class*=shadow-])]:ms-px [&>[data-slot]:not(:has(~[data-slot]))]:rounded-e-md! [&>[data-slot]~[data-slot]]:-ms-px [&>[data-slot]~[data-slot]]:rounded-s-none",
				vertical:
					"flex-col *:data-slot:rounded-b-none [&>[data-slot=button]:not([class*=shadow-])~[data-slot=button]:not([class*=shadow-])]:mt-px [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-md! [&>[data-slot]~[data-slot]]:-mt-px [&>[data-slot]~[data-slot]]:rounded-t-none",
			},
		},
		defaultVariants: {
			orientation: "horizontal",
		},
	},
);

function ButtonGroup({
	className,
	orientation,
	...props
}: React.ComponentProps<"fieldset"> & VariantProps<typeof buttonGroupVariants>) {
	return (
		<fieldset
			data-slot="button-group"
			data-orientation={orientation}
			className={cn(buttonGroupVariants({ orientation }), className)}
			{...props}
		/>
	);
}

export { ButtonGroup, buttonGroupVariants };
