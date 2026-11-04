import { expect, it } from "vite-plus/test";
import {
	canUseCareerStory,
	interviewPreparationDue,
	storyDraftFactIds,
	threePracticeQuestions,
} from "./career-practice";

it("starts a shared story only with its cited active shared facts", () => {
	const fact = { id: "shared", text: "I rebuilt the design system.", applicationId: null, status: "active" };
	const facts = [
		fact,
		{ ...fact, id: "excluded", status: "excluded" },
		{ ...fact, id: "forgotten", status: "forgotten" },
		{ ...fact, id: "private", applicationId: "job" },
		{ ...fact, id: "other", text: "An unrelated fact." },
		{ ...fact, id: "blank", text: "" },
	];
	expect(storyDraftFactIds({ detail: "Use “I rebuilt the\n design system.” as evidence." }, facts)).toEqual(["shared"]);
	expect(
		storyDraftFactIds({ detail: "Design systems", factIds: facts.map((item) => item.id).concat("foreign") }, facts),
	).toEqual(["shared", "other"]);
	expect(storyDraftFactIds({ detail: fact.text, factIds: [] }, facts)).toEqual([]);
	expect(storyDraftFactIds({ detail: "A paraphrase is not an explicit citation." }, facts)).toEqual([]);
	expect(storyDraftFactIds({ detail: "Rustic furniture" }, [{ ...fact, text: "Rust" }])).toEqual([]);
	expect(storyDraftFactIds({ detail: "Use C++ (advanced)." }, [{ ...fact, text: "C++ (advanced)." }])).toEqual([
		"shared",
	]);
});

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
