import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";

/**
 * One toast at a time, bottom centre, 24px from the edge: an ink fill with page-colour text, 12px radius, e3. A new toast replaces the current one,
 * and toasts dismiss themselves after 6 seconds unless created with `timeout: 0`.
 */
const toast = ToastPrimitive.createToastManager();

const DEFAULT_TIMEOUT = 6000;

function ToastIcon({ type }: { type: string | undefined }) {
	if (type === "loading") return <Spinner decorative />;
	if (type === "success") return <Icon name="check-circle" />;
	if (type === "info") return null;
	if (type === "warning") return <Icon name="warning" />;
	if (type === "error") return <Icon name="warning-circle" />;
	return null;
}

/**
 * A toast with an action (usually Undo) burns a thin fuse along its bottom edge for the time it has left. The fuse
 * pauses while the toast is hovered or focused, as its timer does, and is hidden under reduced motion.
 */
function ToastFuse({ timeout }: { timeout: number }) {
	return (
		<span
			aria-hidden="true"
			className="absolute inset-x-0 bottom-0 h-0.5 animate-[toast-fuse_linear_forwards] bg-accent group-data-expanded/toast:[animation-play-state:paused] motion-reduce:hidden ltr:origin-left rtl:origin-right"
			style={{ animationDuration: `${timeout}ms` }}
		/>
	);
}

/**
 * Pressing a toast's action closes the toast, once its own handler has run; the handler can keep it open with
 * `event.preventBaseUIHandler()`. Once closed, the action does nothing while the toast animates out, so a second
 * click can't run Undo twice.
 */
function ToastList({ closeLabel, timeout }: { closeLabel: string; timeout: number }) {
	const { toasts, close } = ToastPrimitive.useToastManager();

	return toasts.map((toastItem) => (
		<ToastPrimitive.Root
			key={toastItem.id}
			toast={toastItem}
			data-slot="toast"
			data-design="toast"
			className="group/toast pointer-events-auto relative flex w-fit max-w-[min(560px,100%)] min-w-[min(280px,100%)] items-center overflow-hidden rounded-lg bg-ink text-bg shadow-e3 transition-[opacity,translate,transform] duration-emphasized ease-enter select-none [grid-area:1/1] data-ending-style:translate-y-2.5 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d3)*0.7)] data-limited:translate-y-2.5 data-limited:opacity-0 data-limited:duration-[calc(var(--d3)*0.7)] data-starting-style:translate-y-2.5 data-starting-style:opacity-0 data-[swipe-direction=down]:data-ending-style:translate-y-[calc(var(--toast-swipe-movement-y)+100%)] data-[swipe-direction=right]:data-ending-style:translate-x-[calc(var(--toast-swipe-movement-x)+100%)] data-[swipe-direction=right]:data-ending-style:translate-y-0"
		>
			<ToastPrimitive.Content
				data-slot="toast-content"
				className="flex min-h-12 w-full items-center gap-3 py-2.5 ps-4 pe-4 text-sm leading-5 [--icon-size:18px] has-data-[slot=toast-action]:pe-2 has-data-[slot=toast-close]:pe-2"
			>
				<ToastIcon type={toastItem.type} />
				<div className="flex min-w-0 flex-col gap-0.5">
					<ToastPrimitive.Title data-slot="toast-title" className="empty:hidden" />
					<ToastPrimitive.Description
						data-slot="toast-description"
						className="empty:hidden [[data-slot=toast-title]:not(:empty)~&]:text-[13px] [[data-slot=toast-title]:not(:empty)~&]:leading-[18px] [[data-slot=toast-title]:not(:empty)~&]:opacity-80"
					/>
				</div>
				{/* The optional action, usually Undo: semibold, in the toast's text colour, at the end. */}
				{toastItem.actionProps && (
					<ToastPrimitive.Action
						data-slot="toast-action"
						onClickCapture={(event) => {
							if (event.currentTarget.dataset.actionRan === undefined) return;
							event.preventDefault();
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.currentTarget.dataset.actionRan = "";
							close(toastItem.id);
						}}
						className="ms-auto inline-flex h-7 shrink-0 items-center rounded-sm px-2 font-semibold transition-colors hover:bg-bg/10"
					/>
				)}
				{toastItem.timeout === 0 && toastItem.type !== "info" && (
					<ToastPrimitive.Close
						data-slot="toast-close"
						aria-label={closeLabel}
						className="ms-auto inline-flex size-7 shrink-0 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 [[data-slot=toast-action]~&]:ms-0"
					>
						<Icon name="x" size={18} />
					</ToastPrimitive.Close>
				)}
			</ToastPrimitive.Content>
			{toastItem.actionProps && toastItem.timeout !== 0 && <ToastFuse timeout={toastItem.timeout ?? timeout} />}
		</ToastPrimitive.Root>
	));
}

type ToasterProps = ToastPrimitive.Provider.Props & {
	/** Accessible name of the close button on toasts that stay until dismissed; pass a translated string. */
	closeLabel?: string;
	/** Accessible name of the region screen readers announce toasts in; pass a translated string. */
	regionLabel?: string;
};

function Toaster({
	children,
	toastManager = toast,
	closeLabel = "Close notification",
	regionLabel = "Notifications",
	limit = 1,
	timeout = DEFAULT_TIMEOUT,
	...props
}: ToasterProps) {
	return (
		<ToastPrimitive.Provider toastManager={toastManager} limit={limit} timeout={timeout} {...props}>
			{children}
			<ToastPrimitive.Portal data-slot="toast-portal">
				<ToastPrimitive.Viewport
					data-slot="toast-viewport"
					aria-label={regionLabel}
					className="pointer-events-none fixed start-[var(--toast-start,1rem)] end-[var(--toast-end,1rem)] bottom-[var(--toast-bottom,1.5rem)] z-200 grid justify-items-center outline-none"
				>
					<ToastList closeLabel={closeLabel} timeout={timeout} />
				</ToastPrimitive.Viewport>
			</ToastPrimitive.Portal>
		</ToastPrimitive.Provider>
	);
}

export { Toaster, toast };
