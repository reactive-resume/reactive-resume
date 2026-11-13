import type { VariantProps } from "class-variance-authority";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import { isValidElement } from "react";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";

// Written out in full so Tailwind finds the classes: the secondary look, for a primary button outside an open dialog
// or sheet (`data-top-layer` on their popups).
const behindTopLayer =
	"[body:has([data-top-layer][data-open])_&:not([data-top-layer]_*)]:bg-surface [body:has([data-top-layer][data-open])_&:not([data-top-layer]_*)]:text-ink [body:has([data-top-layer][data-open])_&:not([data-top-layer]_*)]:shadow-[inset_0_0_0_1px_var(--line-2)]";

/**
 * Calm buttons: 28 · 36 · 44 high with 8 · 10 · 12 corners, 13 · 14 · 15px medium labels and 16 · 18 · 20px icons.
 * `primary` is the one accent button of a view; `soft` is Accept on a proposal; `danger-text` is a reversible removal
 * (Move to Trash) and `danger` the permanent delete. A disabled button fades as a whole to 45%.
 */
const baseButtonVariants = cva(
	"group/button touch-target relative inline-flex shrink-0 items-center justify-center gap-2 text-sm leading-5 font-medium whitespace-nowrap transition-[background-color,box-shadow,color,filter,opacity,scale] duration-quick ease-enter select-none disabled:pointer-events-none aria-busy:cursor-progress data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			keepAccent: { true: "" },
			variant: {
				// One accent per view: while a dialog or sheet is open, a primary button behind its scrim looks secondary.
				primary: "bg-accent text-on-accent hover:bg-accent-hover",
				secondary:
					"bg-surface text-ink shadow-[inset_0_0_0_1px_var(--line-2)] hover:bg-sunken active:bg-press aria-expanded:bg-sunken",
				ghost:
					"text-ink-2 hover:bg-hover hover:text-ink active:bg-press aria-expanded:bg-hover aria-pressed:bg-accent-soft aria-pressed:text-accent-text",
				soft: "bg-accent-soft text-accent-text hover:bg-[color-mix(in_oklab,var(--accent-soft),var(--ink)_6%)] active:bg-[color-mix(in_oklab,var(--accent-soft),var(--ink)_10%)]",
				// White on danger-fill, as the boards draw it: the fill is the same strength in both themes.
				danger: "bg-danger-fill text-paper hover:brightness-[0.92]",
				"danger-text": "text-danger-text hover:bg-danger-soft active:bg-danger-soft aria-expanded:bg-danger-soft",
				link: "h-auto! px-0! text-accent-text underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 rounded-md px-3.5 [--icon-size:18px]",
				sm: "h-7 gap-1.5 rounded-sm px-2.5 text-[13px] leading-[18px] [--icon-size:16px]",
				lg: "h-11 rounded-lg px-[18px] text-[15px] leading-5 [--icon-size:20px]",
				icon: "size-9 rounded-md [--icon-size:20px]",
				"icon-sm": "size-7 rounded-sm [--icon-size:16px]",
				"icon-xs": "size-7 rounded-sm [--icon-size:16px]",
				"icon-lg": "size-11 rounded-md [--icon-size:20px]",
			},
		},
		compoundVariants: [
			{ variant: "primary", keepAccent: false, className: behindTopLayer },
			// Press feedback; a text link doesn't press, and a loading button blocks activation.
			{
				variant: ["primary", "secondary", "ghost", "soft", "danger", "danger-text"],
				className: "not-aria-busy:active:scale-[0.97]",
			},
		],
		defaultVariants: {
			variant: "primary",
			keepAccent: false,
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
function buttonVariants({ variant, size, keepAccent, className }: ButtonVariantProps = {}) {
	const ownHeight = !!className && OWN_HEIGHT.test(className);
	const touch =
		ownHeight || variant === "link"
			? undefined
			: (size ?? "default") === "default"
				? "pointer-coarse:h-11"
				: size === "icon" && variant === "secondary"
					? "pointer-coarse:size-11"
					: undefined;
	return cn(baseButtonVariants({ variant, size, keepAccent }), touch, className);
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
	keepAccent = false,
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
			className={buttonVariants({
				variant,
				size,
				keepAccent,
				className: typeof className === "string" ? className : undefined,
			})}
			onClick={loading ? (event) => event.preventDefault() : onClick}
			{...props}
		>
			{loading && <Spinner decorative />}
			{children}
		</ButtonPrimitive>
	);
}

export { Button, type ButtonProps, buttonVariants };
