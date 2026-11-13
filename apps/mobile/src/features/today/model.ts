import type { useToday } from "@/data";
import {
	getNextStep,
	latestOfferHints,
	needsAttention,
	nextStepSortKey,
	compareNextStepSortKeys,
} from "@reactive-resume/schema/applications/next-step";

type Today = ReturnType<typeof useToday>;
type Application = NonNullable<Today["applications"]["data"]>[number];
type Offer = NonNullable<Today["offers"]["data"]>[number];

export function todaySteps(
	applications: readonly Application[],
	offers: readonly Offer[],
	now: Date,
	timeZone: string,
) {
	const hints = latestOfferHints(offers);
	return applications
		.map((application) => ({
			application,
			step: getNextStep(application, now, timeZone, hints.get(application.id)),
			key: nextStepSortKey(application, now, timeZone, hints.get(application.id)),
		}))
		.filter(({ step }) => needsAttention(step, now))
		.sort((a, b) => compareNextStepSortKeys(a.key, b.key, a.application.id, b.application.id));
}

export function chooseHero<T extends { step: ReturnType<typeof getNextStep> }>(
	steps: readonly T[],
	now: Date,
): T | undefined {
	return (
		steps.find(({ step }) => step.kind === "interview" && step.at.getTime() - now.getTime() <= 48 * 3_600_000) ??
		steps[0]
	);
}
