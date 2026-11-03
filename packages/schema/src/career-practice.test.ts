import { expect, it } from "vite-plus/test";
import { canUseCareerStory, interviewPreparationDue, threePracticeQuestions } from "./career-practice";

it("offers immediate preparation only from the start of the 24-hour window through interview start", () => {
	const now = new Date("2026-11-03T10:00:00Z");
	for (const [offset, due] of [
		[-1, false],
		[0, true],
		[86_400_000, true],
		[86_400_001, false],
	] as const)
		expect(interviewPreparationDue(new Date(now.getTime() + offset), now)).toBe(due);
	expect(interviewPreparationDue("not-a-date", now)).toBe(false);
});

it("keeps actual question origins and fills exactly three distinct questions without repeating saved questions", () => {
	expect(
		threePracticeQuestions(
			[
				{ text: "Round question", origin: "simulated" },
				{ text: " Round question ", origin: "recalled" },
				{ text: "Recalled question", origin: "recalled" },
			],
			["Round question", "Fallback one", "Fallback two", "Fallback three"],
		),
	).toEqual([
		{ text: "Round question", origin: "simulated" },
		{ text: "Recalled question", origin: "recalled" },
		{ text: "Fallback one", origin: "simulated" },
	]);
});

it("allows only backed, unchanged stories and facts visible in the selected scope", () => {
	const at = new Date("2026-11-01");
	const fact = { id: "fact", applicationId: null, status: "active", updatedAt: at, revisions: [] };
	const story = { applicationId: null, updatedAt: at, data: { factIds: [fact.id] } };
	expect(canUseCareerStory(story, [fact], null)).toBe(true);
	expect(canUseCareerStory({ ...story, data: { factIds: [] } }, [fact], null)).toBe(false);
	expect(canUseCareerStory(story, [{ ...fact, status: "excluded" }], null)).toBe(false);
	expect(canUseCareerStory(story, [{ ...fact, applicationId: "private" }], null)).toBe(false);
	expect(canUseCareerStory(story, [{ ...fact, applicationId: "private" }], "private")).toBe(true);
	expect(canUseCareerStory({ ...story, applicationId: "private" }, [fact], null)).toBe(false);
	expect(canUseCareerStory(story, [{ ...fact, revisions: [{}], updatedAt: new Date("2026-11-02") }], null)).toBe(false);
});
