import type { VariantProps } from "class-variance-authority";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import { isValidElement } from "react";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";

const baseButtonVariants = cva(
	"group/button touch-target relative inline-flex shrink-0 items-center justify-center gap-2 border border-transparent text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,filter,scale] duration-quick ease-enter select-none disabled:pointer-events-none aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				primary: "bg-accent font-semibold text-on-accent hover:bg-accent-hover disabled:bg-sunken disabled:text-ink-3",
				secondary:
					"border-line-2 bg-surface text-ink hover:bg-sunken active:bg-press disabled:border-line disabled:text-ink-3 aria-expanded:bg-sunken",
				ghost: "text-ink hover:bg-hover active:bg-press disabled:text-ink-3 aria-expanded:bg-hover",
				danger:
					"bg-danger text-white hover:brightness-[0.92] focus-visible:outline-danger disabled:bg-sunken disabled:text-ink-3",
				link: "h-auto! border-0 px-0! text-accent-text underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 rounded-md px-3.5",
				sm: "h-7 gap-1.5 rounded-sm px-2.5 text-[13px]",
				lg: "h-11 rounded-lg px-4 text-base",
				icon: "size-9 rounded-md",
				"icon-sm": "size-8 rounded-md",
				"icon-xs": "size-7 rounded-sm",
				"icon-lg": "size-11 rounded-lg",
			},
		},
		compoundVariants: [
			{ variant: "ghost", size: "default", className: "px-3" },
			// Press feedback; a text link doesn't press, and a loading button blocks activation.
			{ variant: ["primary", "secondary", "ghost", "danger"], className: "not-aria-busy:active:scale-[0.97]" },
		],
		defaultVariants: {
			variant: "primary",
			size: "default",
		},
	},
);

const OWN_HEIGHT = /(?:^|\s)(?:[\w-[\]&*>]+:)*(?:h|size)-/;

type ButtonVariantProps = VariantProps<typeof baseButtonVariants> & { className?: string | undefined };

/**
 * Touch inputs are 44px, so on touch screens a default button, and a bordered icon button that sits beside inputs,
 * grow to match. A caller that sets its own height or size keeps it.
 */
function buttonVariants({ variant, size, className }: ButtonVariantProps = {}) {
	const ownHeight = !!className && OWN_HEIGHT.test(className);
	const touch =
		ownHeight || variant === "link"
			? undefined
			: (size ?? "default") === "default"
				? "pointer-coarse:h-11"
				: size === "icon" && variant === "secondary"
					? "pointer-coarse:size-11"
					: undefined;
	return cn(baseButtonVariants({ variant, size }), touch, className);
}

type ButtonProps = ButtonPrimitive.Props &
	VariantProps<typeof baseButtonVariants> & {
		/** Shows a spinner and blocks activation. Pair it with a present-participle label ("Preparing…"). */
		loading?: boolean;
	};

function Button({
	className,
	type = "button",
	variant = "primary",
	size = "default",
	loading = false,
	onClick,
	children,
	...props
}: ButtonProps) {
	// Rendered as a link (an <a href> or a router <Link to>), it stays a link to assistive tech: Base UI would otherwise
	// give it role="button", and screen readers would leave it out of their links list.
	const renderProps = isValidElement<{ href?: unknown; to?: unknown }>(props.render) ? props.render.props : null;
	const isLink = props.nativeButton === false && !!renderProps && (renderProps.href != null || renderProps.to != null);
	return (
		<ButtonPrimitive
			data-slot="button"
			type={type}
			{...(isLink ? { role: "link" } : {})}
			aria-busy={loading || undefined}
			className={buttonVariants({ variant, size, className: typeof className === "string" ? className : undefined })}
			onClick={loading ? (event) => event.preventDefault() : onClick}
			{...props}
		>
			{loading && <Spinner decorative />}
			{children}
		</ButtonPrimitive>
	);
}

export { Button, type ButtonProps, buttonVariants };
