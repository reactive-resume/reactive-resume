import { describe, expect, it } from "vite-plus/test";
import {
	answerFactRevision,
	answerStoryRevision,
	answerRelevance,
	answerScopeAllows,
	normalizeAnswerText,
	reviewedAnswerEvidence,
	reviewedAnswerInputSchema,
} from "./application-answers";

describe("reviewed answer contracts", () => {
	it("ranks exact and similar questions locally, preserving Unicode", () => {
		expect(normalizeAnswerText("  Ａ Project\n Example  ")).toBe("a project example");
		expect(answerRelevance("Describe your best project", "Describe your best project")).toBe(2);
		expect(answerRelevance("Describe a recent project", "Describe your best project")).toBeGreaterThan(0.3);
		expect(answerRelevance("Unrelated", "Describe your best project")).toBe(0);
		expect(answerRelevance("日本語 経験", "経験")).toBeGreaterThan(0);
	});
	it("restricts application and employer scopes and requires review for universal reuse", () => {
		const target = { id: "second", company: " Harbor Labs " };
		expect(answerScopeAllows({ scope: "employer", employer: "HARBOR LABS", applicationId: null }, target)).toBe(true);
		expect(answerScopeAllows({ scope: "employer", employer: "Other", applicationId: null }, target)).toBe(false);
		expect(answerScopeAllows({ scope: "application", employer: "Harbor Labs", applicationId: "first" }, target)).toBe(
			false,
		);
		const input = {
			applicationId: "first",
			question: "Why?",
			answer: "My reason",
			source: "ai-assisted",
			scope: "reusable",
			factIds: [],
			storyIds: [],
			expectedEvidence: [],
			reviewed: true,
			noEmployerWording: false,
		};
		expect(reviewedAnswerInputSchema.safeParse(input).success).toBe(false);
		expect(reviewedAnswerInputSchema.safeParse({ ...input, noEmployerWording: true }).success).toBe(true);
		expect(reviewedAnswerInputSchema.safeParse({ ...input, noEmployerWording: true, reviewed: false }).success).toBe(
			false,
		);
	});
	it("pins selected identities and transitive story evidence without copying private evidence text", () => {
		const at = new Date("2026-10-31T00:00:00Z");
		const a = {
			id: "a",
			updatedAt: at,
			text: "Reviewed fact",
			category: "experience",
			status: "active",
			applicationId: null,
			source: { kind: "manual", id: "manual", quote: "Reviewed fact" },
		};
		const b = { ...a, id: "b" };
		const story = {
			id: "s",
			updatedAt: at,
			applicationId: null,
			data: {
				title: "Project",
				situation: "Situation",
				task: "Task",
				action: "Action",
				result: "",
				reflection: "",
				factIds: ["b"],
				tags: [],
			},
		};
		const refs = reviewedAnswerEvidence([b, a], [story], ["a", "a"], ["s"]);
		expect(refs).toEqual([
			{ kind: "fact", id: "a", revision: answerFactRevision(a) },
			{ kind: "fact", id: "b", revision: answerFactRevision(b) },
			{ kind: "story", id: "s", revision: answerStoryRevision(story) },
		]);
		expect(answerFactRevision({ ...a, text: "Corrected within the same millisecond" })).not.toBe(answerFactRevision(a));
		expect(answerStoryRevision({ ...story, data: { ...story.data, action: "Corrected action" } })).not.toBe(
			answerStoryRevision(story),
		);
	});
});
