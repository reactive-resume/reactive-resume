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
	status: ApplicationStatus;
	/** A renamed lane's name, in place of the standard one. */
	label?: ReactNode;
	/** When the application reached this stage. */
	date?: ReactNode;
	/** A custom lane's own colour. */
	color?: string | undefined;
};

type StageStepperProps = Omit<ComponentProps<"ol">, "children"> & {
	/** The stage the application is in. A stage that is not among the steps leaves every step still to come. */
	current: ApplicationStatus;
	/** Saved to Offer unless given. */
	steps?: readonly StageStep[];
};

/**
 * Calm stage stepper (`.stp`): every stage by name, in order, as done, current or still to come. It shows the stage;
 * changing it happens in the stage button beside the title. Give it an `aria-label`.
 */
export function StageStepper({
	current,
	steps = PIPELINE.map((status) => ({ status })),
	className,
	...props
}: StageStepperProps) {
	const currentIndex = steps.findIndex((step) => step.status === current);

	return (
		<ol data-design="stp" className={cn("grid auto-cols-fr grid-flow-col gap-1.5", className)} {...props}>
			{steps.map((step, index) => {
				const state = index < currentIndex ? "done" : index === currentIndex ? "now" : "todo";
				const label = step.label ?? getStageLabel(step.status);

				return (
					<li
						key={step.status}
						data-state={state}
						aria-current={state === "now" ? "step" : undefined}
						className={cn(
							"flex flex-wrap content-start items-center gap-x-1.5 gap-y-px border-t-[3px] pt-2.5 text-[13px]/[18px] font-medium",
							state === "done" && "border-t-ink-3 text-ink-2",
							state === "now" && cn("font-semibold text-ink", !step.color && BAR_COLOR[step.status]),
							state === "todo" && "border-t-line text-ink-3",
						)}
						style={state === "now" && step.color ? { borderTopColor: step.color } : undefined}
					>
						{state === "done" && <Icon name="check" size={14} />}
						{state === "now" ? (
							<StageDot status={step.status} color={step.color}>
								{label}
							</StageDot>
						) : (
							label
						)}
						{state === "done" && (
							<span className="sr-only">
								<Trans comment="Read after a stage name in the application's stage stepper: this stage is finished.">
									done
								</Trans>
							</span>
						)}
						{step.date && <small className="basis-full text-xs font-normal text-ink-3">{step.date}</small>}
					</li>
				);
			})}
		</ol>
	);
}
