import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ComponentProps, ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { StageDot } from "./stage-dot";
import { getStageLabel, PIPELINE } from "@/features/applications/stages";

const BAR_COLOR: Record<ApplicationStatus, string> = {
	saved: "border-t-stage-saved",
	applied: "border-t-stage-applied",
	screening: "border-t-stage-screening",
	interview: "border-t-stage-interview",
	offer: "border-t-stage-offer",
	closed: "border-t-stage-closed",
};

export type StageStep = {
	/** What `current` matches and the step's key: a lane's id. The status when not given. */
	id?: string;
	/** The standard step this one counts as. Custom lanes can share one. */
	status: ApplicationStatus;
	/** A renamed or added lane's name, in place of the standard one. */
	label?: ReactNode;
	/** When the application reached this stage. */
	date?: ReactNode;
	/** A custom lane's own colour. */
	color?: string | undefined;
};

type StageStepperProps = Omit<ComponentProps<"ol">, "children" | "onSelect"> & {
	/**
	 * The step the application is in: a step's `id`, or its status when the steps have no ids. A value that is not
	 * among the steps leaves every step still to come.
	 */
	current: string;
	/** Saved to Offer unless given. */
	steps?: readonly StageStep[];
	/**
	 * `progress` (`.stp`): a check before done steps and the dot before the current one. `history` (`.hst`, the
	 * Details sheet): names only, each with the date it was reached under it.
	 */
	variant?: "progress" | "history";
	/** Makes each step a button that moves the application there. */
	onSelect?: (step: StageStep) => void;
};

const stepKey = (step: StageStep) => step.id ?? step.status;

/**
 * Calm stage stepper (`.stp`, `.hst`): every stage by name, in order, as done, current or still to come. It shows the
 * stage; changing it happens in the stage button beside the title, or with `onSelect`. Give it an `aria-label`.
 */
export function StageStepper({
	current,
	steps = PIPELINE.map((status) => ({ status })),
	variant = "progress",
	onSelect,
	className,
	...props
}: StageStepperProps) {
	const currentIndex = steps.findIndex((step) => stepKey(step) === current);
	const history = variant === "history";

	return (
		<ol data-design="stp" className={cn("grid auto-cols-fr grid-flow-col gap-1.5", className)} {...props}>
			{steps.map((step, index) => {
				const state = index < currentIndex ? "done" : index === currentIndex ? "now" : "todo";
				const label = step.label ?? getStageLabel(step.status);
				const stepClassName = cn(
					"flex min-w-0 border-t-[3px] text-[13px]/[18px] font-medium",
					history
						? "flex-col gap-px pt-2 text-start"
						: "flex-wrap content-start items-center gap-x-1.5 gap-y-px pt-2.5",
					state === "done" && "border-t-ink-3 text-ink-2",
					state === "now" && cn("font-semibold text-ink", !step.color && BAR_COLOR[step.status]),
					state === "todo" && "border-t-line text-ink-3",
				);
				const style = state === "now" && step.color ? { borderTopColor: step.color } : undefined;
				// The name is the step's own text, so it reads (and measures) as the whole step.
				const content = (
					<>
						{!history && state === "done" && <Icon name="check" size={14} />}
						{!history && state === "now" && (
							<StageDot status={step.status} color={step.color}>
								{null}
							</StageDot>
						)}
						{label}
						{state === "done" && (
							<span className="sr-only">
								<Trans comment="Read after a stage name in the application's stage stepper: this stage is finished.">
									done
								</Trans>
							</span>
						)}
						{(step.date || history) && (
							<small className={cn("text-xs font-normal text-ink-3", !history && "basis-full")}>
								{step.date || " "}
							</small>
						)}
					</>
				);

				if (onSelect)
					return (
						<li key={stepKey(step)} data-state={state} className="flex min-w-0">
							<button
								type="button"
								aria-current={state === "now" ? "step" : undefined}
								onClick={() => onSelect(step)}
								className={cn(stepClassName, "w-full rounded-xs transition-colors duration-standard hover:text-ink")}
								style={style}
							>
								{content}
							</button>
						</li>
					);

				return (
					<li
						key={stepKey(step)}
						data-state={state}
						aria-current={state === "now" ? "step" : undefined}
						className={stepClassName}
						style={style}
					>
						{content}
					</li>
				);
			})}
		</ol>
	);
}
