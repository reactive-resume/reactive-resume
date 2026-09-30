import type { VariantProps } from "class-variance-authority";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva } from "class-variance-authority";
import { cn } from "@reactive-resume/utils/style";

/** Status pills. Color always pairs with text; never use a badge as the only signal. */
const badgeVariants = cva(
	"group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-xs font-medium whitespace-nowrap [&>[data-slot=icon]]:text-[15px]! [&>svg]:pointer-events-none [&>svg]:size-3!",
	{
		variants: {
			variant: {
				neutral: "bg-sunken text-ink-2",
				accent: "bg-accent-soft text-accent-text",
				solid: "bg-accent text-on-accent",
				warn: "bg-warn-soft text-warn-text",
				danger: "bg-danger-soft text-danger-text",
				info: "bg-info-soft text-info-text",
				outline: "border-line-2 text-ink-2",
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
