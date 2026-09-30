import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";

/**
 * One toast at a time, bottom center, ink on the desk color. A new toast replaces the current one,
 * and toasts dismiss themselves after 6 seconds unless created with `timeout: 0`.
 */
const toast = ToastPrimitive.createToastManager();

function ToastProvider({ limit = 1, timeout = 6000, ...props }: ToastPrimitive.Provider.Props) {
	return <ToastPrimitive.Provider limit={limit} timeout={timeout} {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
	return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
	return (
		<ToastPrimitive.Viewport
			data-slot="toast-viewport"
			className={cn(
				"pointer-events-none fixed inset-x-4 bottom-7 z-200 grid justify-items-center outline-none",
				className,
			)}
			{...props}
		/>
	);
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
	return (
		<ToastPrimitive.Root
			data-slot="toast"
			className={cn(
				"group/toast pointer-events-auto flex w-fit max-w-[min(560px,100%)] items-center rounded-lg bg-ink text-bg shadow-e3 transition-[opacity,translate,transform] duration-emphasized ease-enter select-none [grid-area:1/1] data-ending-style:translate-y-2.5 data-ending-style:opacity-0 data-ending-style:duration-[calc(var(--d3)*0.7)] data-limited:translate-y-2.5 data-limited:opacity-0 data-limited:duration-[calc(var(--d3)*0.7)] data-starting-style:translate-y-2.5 data-starting-style:opacity-0 data-[swipe-direction=down]:data-ending-style:translate-y-[calc(var(--toast-swipe-movement-y)+100%)] data-[swipe-direction=right]:data-ending-style:translate-x-[calc(var(--toast-swipe-movement-x)+100%)] data-[swipe-direction=right]:data-ending-style:translate-y-0",
				className,
			)}
			{...props}
		/>
	);
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
	return (
		<ToastPrimitive.Content
			data-slot="toast-content"
			className={cn("flex min-h-11 items-center gap-3 px-4 py-2.5", className)}
			{...props}
		/>
	);
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
	return (
		<ToastPrimitive.Title
			data-slot="toast-title"
			className={cn("text-sm font-semibold empty:hidden", className)}
			{...props}
		/>
	);
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
	return (
		<ToastPrimitive.Description
			data-slot="toast-description"
			className={cn("text-sm font-medium empty:hidden", className)}
			{...props}
		/>
	);
}

/** The optional action, usually Undo: underlined, semibold, in the toast's text color. */
function ToastAction({ className, ...props }: ToastPrimitive.Action.Props) {
	return (
		<ToastPrimitive.Action
			data-slot="toast-action"
			className={cn(
				"-my-1 shrink-0 rounded-sm px-1 py-1 text-sm font-semibold underline underline-offset-3 transition-opacity hover:opacity-80",
				className,
			)}
			{...props}
		/>
	);
}

function ToastClose({ className, children, ...props }: ToastPrimitive.Close.Props) {
	return (
		<ToastPrimitive.Close
			data-slot="toast-close"
			aria-label="Close"
			className={cn(
				"-me-2 inline-flex size-7 shrink-0 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100",
				className,
			)}
			{...props}
		>
			{children ?? <Icon name="close" size={18} />}
		</ToastPrimitive.Close>
	);
}

function ToastIcon({ type }: { type: string | undefined }) {
	if (type === "loading") return <Spinner decorative />;
	if (type === "success") return <Icon name="check_circle" />;
	if (type === "info") return <Icon name="info" />;
	if (type === "warning") return <Icon name="warning" />;
	if (type === "error") return <Icon name="error" />;
	return null;
}

function ToastList() {
	const { toasts } = ToastPrimitive.useToastManager();

	return toasts.map((toastItem) => (
		<Toast key={toastItem.id} toast={toastItem}>
			<ToastContent>
				<ToastIcon type={toastItem.type} />
				<div className="flex min-w-0 flex-col gap-0.5">
					<ToastTitle />
					<ToastDescription />
				</div>
				{toastItem.actionProps && <ToastAction />}
				{toastItem.timeout === 0 && <ToastClose />}
			</ToastContent>
		</Toast>
	));
}

function Toaster({ children, toastManager = toast, ...props }: ToastPrimitive.Provider.Props) {
	return (
		<ToastProvider toastManager={toastManager} {...props}>
			{children}
			<ToastPortal>
				<ToastViewport>
					<ToastList />
				</ToastViewport>
			</ToastPortal>
		</ToastProvider>
	);
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
	createToastManager,
	Toast,
	ToastAction,
	ToastClose,
	ToastContent,
	ToastDescription,
	Toaster,
	ToastPortal,
	ToastProvider,
	ToastTitle,
	ToastViewport,
	toast,
	useToastManager,
};
