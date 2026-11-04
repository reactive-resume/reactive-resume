export type PracticeQuestion = { text: string; origin: "simulated" | "recalled" };

type StoryDraftStep = { detail: string; factIds?: readonly string[] | undefined };
type StoryDraftFact = { id: string; text: string; status: string; applicationId: string | null };

/** Old steps can cite a fact verbatim; new steps carry IDs. A shared story only accepts active shared facts. */
export function storyDraftFactIds(step: StoryDraftStep, facts: readonly StoryDraftFact[]) {
	const detail = step.detail.replace(/\s+/g, " ").trim();
	return facts
		.filter((fact) => {
			if (fact.status !== "active" || fact.applicationId !== null || !fact.text.trim()) return false;
			if (step.factIds !== undefined) return step.factIds.includes(fact.id);
			const quote = fact.text.replace(/\s+/g, " ").trim();
			const literal = quote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			return new RegExp(`(^|[^\\p{L}\\p{N}])${literal}($|[^\\p{L}\\p{N}])`, "u").test(detail);
		})
		.map((fact) => fact.id)
		.slice(0, 30);
}

/** Eligibility for Today's immediate preparation actions; existing calendar/event ordering stays with its owner. */
export function interviewPreparationDue(at: Date | string, now: Date) {
	const remaining = new Date(at).getTime() - now.getTime();
	return remaining >= 0 && remaining <= 24 * 60 * 60 * 1000;
}

/** Keep the round's questions first, filling a three-question warm-up from the existing generic questions. */
export function threePracticeQuestions(questions: readonly PracticeQuestion[], fallbacks: readonly string[]) {
	const selected: PracticeQuestion[] = [];
	for (const question of [
		...questions,
		...fallbacks.map((text): PracticeQuestion => ({ text, origin: "simulated" })),
	]) {
		if (!question.text.trim() || selected.some((item) => item.text.trim() === question.text.trim())) continue;
		selected.push(question);
		if (selected.length === 3) break;
	}
	return selected;
}

type StoryForPractice = {
	applicationId?: string | null;
	updatedAt: Date | string;
	data: { factIds: readonly string[] };
};
type FactForPractice = {
	id: string;
	applicationId: string | null;
	status: string;
	updatedAt: Date | string;
	revisions: readonly unknown[];
};

/** The same backing-fact and scope check in Knowledge, practice and the server's generation context. */
export function canUseCareerStory(
	story: StoryForPractice,
	facts: readonly FactForPractice[],
	applicationId: string | null,
) {
	return (
		(!story.applicationId || story.applicationId === applicationId) &&
		story.data.factIds.length > 0 &&
		story.data.factIds.every((id) =>
			facts.some(
				(fact) =>
					fact.id === id &&
					fact.status === "active" &&
					(fact.applicationId === null || fact.applicationId === applicationId) &&
					(fact.revisions.length === 0 || new Date(fact.updatedAt) <= new Date(story.updatedAt)),
			),
		)
	);
}
