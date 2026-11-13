import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ComponentProps } from "react";
import { cn } from "@reactive-resume/utils/style";
import { getStageLabel } from "@/features/applications/stages";

const DOT_COLOR: Record<ApplicationStatus, string> = {
	saved: "bg-stage-saved",
	applied: "bg-stage-applied",
	screening: "bg-stage-screening",
	interview: "bg-stage-interview",
	offer: "bg-stage-offer",
	closed: "bg-stage-closed",
};

type StageDotProps = ComponentProps<"span"> & {
	status: ApplicationStatus;
	/** A custom lane's own colour, in place of the stage token. */
	color?: string | undefined;
};

/**
 * Calm stage dot (`.dot`): an 8px dot that always sits directly before the stage's name. Children replace the
 * standard name (a renamed lane, "Interview · Tue 10 Nov"). Pass `null` only where the row's own text names the stage.
 */
export function StageDot({ status, color, className, children, ...props }: StageDotProps) {
	return (
		<span className={cn("inline-flex items-center gap-1.5", className)} {...props}>
			<span
				aria-hidden="true"
				className={cn("size-2 shrink-0 rounded-full", !color && DOT_COLOR[status])}
				style={color ? { backgroundColor: color } : undefined}
			/>
			{children === undefined ? getStageLabel(status) : children}
		</span>
	);
}

/** Calm warn mark (`.wdot`): decoration only. The control or line beside it says in words what it marks. */
export function WarnDot({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			aria-hidden="true"
			className={cn("inline-block size-2 shrink-0 rounded-full bg-warn-mark", className)}
			{...props}
		/>
	);
}
