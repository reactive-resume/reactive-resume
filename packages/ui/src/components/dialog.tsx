import type * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={cn(
				"fixed inset-0 isolate z-50 bg-scrim transition-opacity duration-standard ease-enter data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-starting-style:opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * The dialog box, shared with AlertDialog: `raised`, 20px radius, e3, 28px padding, 16px between parts, as wide as
 * `--dialog` (480) from 640px up. Under 640px it is a bottom sheet across the window that slides up.
 * Padding is a variable so a caller's `p-0` still wins at every width.
 */
const dialogPopupClassName =
	"fixed inset-s-0 inset-e-0 bottom-0 z-50 grid max-h-[calc(100svh-2rem)] w-full gap-4 overflow-y-auto overscroll-contain rounded-t-2xl bg-raised p-(--dialog-pad) text-sm text-ink shadow-e3 transition-[opacity,scale,translate] duration-standard ease-enter outline-none [--dialog-pad:20px] data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d2)*0.7)] data-starting-style:opacity-0 max-sm:data-ending-style:translate-y-full max-sm:data-starting-style:translate-y-full sm:inset-s-1/2 sm:inset-e-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-2rem)] sm:max-w-(--dialog) sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:[--dialog-pad:28px] sm:data-ending-style:scale-[0.98] sm:data-starting-style:scale-[0.98] sm:rtl:translate-x-1/2";

/** A close button needs a name in the interface language: required whenever the button shows. */
type CloseButtonProps =
	| { showCloseButton?: true; /** Accessible name of the close button; pass a translated string. */ closeLabel: string }
	| { showCloseButton: false; closeLabel?: string };

type DialogContentProps = DialogPrimitive.Popup.Props & {
	/** Skip the open/close transition, for dialogs toggled many times a day (e.g. the command bar). */
	instant?: boolean;
} & CloseButtonProps;

/** Centred over the scrim; fades and scales in from 98% over 200ms. Use for decisions, not for tasks beside the page. */
function DialogContent({
	className,
	children,
	showCloseButton = true,
	closeLabel = "Close",
	instant = false,
	...props
}: DialogContentProps) {
	return (
		<DialogPortal>
			<DialogOverlay className={cn(instant && "transition-none")} />
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				data-design="dialog"
				className={cn(dialogPopupClassName, instant && "transition-none", className)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						aria-label={closeLabel}
						render={
							<Button
								variant="ghost"
								size="icon"
								className="absolute inset-e-[calc(var(--dialog-pad)-8px)] top-[calc(var(--dialog-pad)-4px)]"
							/>
						}
					>
						<Icon name="x" />
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Popup>
		</DialogPortal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="dialog-header" className={cn("flex flex-col gap-4 pe-8", className)} {...props} />;
}

function DialogFooter({
	className,
	showCloseButton = false,
	closeLabel = "Close",
	children,
	...props
}: React.ComponentProps<"div"> & {
	showCloseButton?: boolean;
	closeLabel?: string;
}) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn("mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
			{...props}
		>
			{children}
			{showCloseButton && (
				<DialogPrimitive.Close render={<Button variant="secondary" />}>{closeLabel}</DialogPrimitive.Close>
			)}
		</div>
	);
}

/** Dialog and sheet titles use the display serif at 22px. */
function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("font-display text-[22px] leading-7 text-ink", className)}
			{...props}
		/>
	);
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(
				"text-sm leading-5 text-ink-2 *:[a]:text-accent-text *:[a]:underline *:[a]:underline-offset-3",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	type DialogContentProps,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	dialogPopupClassName,
	DialogTitle,
	DialogTrigger,
};
