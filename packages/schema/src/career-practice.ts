export type PracticeQuestion = { text: string; origin: "simulated" | "recalled" };

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
