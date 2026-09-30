import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@reactive-resume/utils/style";

/** Inline alerts: a 20px icon and 13px text. Errors are announced (`role="alert"`); the rest are static. */
const alertVariants = cva(
	"group/alert relative grid w-full gap-0.5 rounded-lg px-3.5 py-3 text-start text-[13px] leading-[19px] has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pe-18 has-[>[data-slot=icon]]:grid-cols-[auto_1fr] has-[>[data-slot=icon]]:gap-x-2.5 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:data-[slot=icon]:row-span-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "bg-sunken text-ink-2",
				info: "bg-info-soft text-info-text",
				success: "bg-accent-soft text-accent-text",
				warn: "bg-warn-soft text-warn-text",
				error: "bg-danger-soft text-danger-text",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return (
		<div
			data-slot="alert"
			role={variant === "error" ? "alert" : undefined}
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn(
				"font-semibold group-has-[>[data-slot=icon]]/alert:col-start-2 group-has-[>svg]/alert:col-start-2",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-pretty group-has-[>[data-slot=icon]]/alert:col-start-2 group-has-[>svg]/alert:col-start-2 [&_p:not(:last-child)]:mb-2",
				className,
			)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
