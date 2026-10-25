import type { ComponentProps } from "react";
import { cn } from "@reactive-resume/utils/style";

/**
 * shadcn Trace: the steps an agent took, one quiet line each ("Read the resume", "Searching the web…"). A running
 * step's title shimmers (it holds still under reduced motion), an error turns danger, a step that never finished is
 * dimmed.
 */
function Trace({ className, ...props }: ComponentProps<"div">) {
	return <div data-slot="trace" className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...props} />;
}

type TraceLineProps = ComponentProps<"p"> & { status?: "running" | "error" | "pending" | undefined };

function TraceLine({ className, status, ...props }: TraceLineProps) {
	return (
		<p
			data-slot="trace-line"
			data-status={status}
			className={cn(
				"flex w-fit max-w-full min-w-0 items-center gap-1.5 text-xs text-ink-3 data-[status=error]:text-danger-text data-[status=pending]:opacity-70 data-[status=running]:*:data-[slot=trace-title]:shimmer",
				className,
			)}
			{...props}
		/>
	);
}

/** A fixed 14px slot, so the title doesn't shift when a spinner turns into a check. */
function TraceIcon({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			data-slot="trace-icon"
			aria-hidden="true"
			className={cn("grid size-3.5 shrink-0 place-items-center", className)}
			{...props}
		/>
	);
}

function TraceTitle({ className, ...props }: ComponentProps<"span">) {
	return <span data-slot="trace-title" className={cn("min-w-0 motion-reduce:shimmer-none", className)} {...props} />;
}

export { Trace, TraceIcon, TraceLine, TraceTitle };
