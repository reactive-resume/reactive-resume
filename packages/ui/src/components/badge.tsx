import type { VariantProps } from "class-variance-authority";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import { cn } from "@reactive-resume/utils/style";

/** A word on a tinted ground: 20px high, 6px corners, 12px medium. Colour always pairs with text. */
const badgeVariants = cva(
	"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs px-1.5 text-xs leading-4 font-medium whitespace-nowrap [&>[data-slot=icon]]:text-[14px]! [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				neutral: "bg-sunken text-ink-2",
				accent: "bg-accent-soft text-accent-text",
				solid: "bg-accent text-on-accent",
				warn: "bg-warn-soft text-warn-text",
				danger: "bg-danger-soft text-danger-text",
				info: "bg-info-soft text-info-text",
				outline: "text-ink-2 shadow-[inset_0_0_0_1px_var(--line-2)]",
				inverse: "bg-ink text-bg",
			},
		},
		defaultVariants: {
			variant: "neutral",
		},
	},
);

function Badge({
	className,
	variant = "neutral",
	render,
	...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return useRender({
		defaultTagName: "span",
		props: mergeProps<"span">(
			{
				className: cn(badgeVariants({ variant }), className),
			},
			props,
		),
		render,
		state: {
			slot: "badge",
			variant,
		},
	});
}

export { Badge, badgeVariants };
