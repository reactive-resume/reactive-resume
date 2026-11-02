import { describe, expect, it } from "vite-plus/test";
import {
	answerFactRevision,
	answerLimit,
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

describe("answerLimit", () => {
	it("reads a word limit in the languages the app ships", () => {
		expect(answerLimit("Describe a reliable service. (150 words max)")).toEqual({ kind: "words", max: 150 });
		expect(answerLimit("¿Por qué quieres trabajar aquí? (máximo 80 palabras)")).toEqual({ kind: "words", max: 80 });
		expect(answerLimit("Beschreibe ein Projekt (max. 200 Wörter)")).toEqual({ kind: "words", max: 200 });
	});

	it("reads a character limit and ignores numbers that are not limits", () => {
		expect(answerLimit("Summarise your work in under 300 characters")).toEqual({ kind: "characters", max: 300 });
		expect(answerLimit("Summarise your work in 300 Zeichen")).toEqual({ kind: "characters", max: 300 });
		expect(answerLimit("Which year did you graduate?")).toBeNull();
		expect(answerLimit("How many applications have you sent in 150 days?")).toBeNull();
	});

	it("does not turn a floor into a maximum", () => {
		expect(answerLimit("Answer in at least 150 words")).toBeNull();
		expect(answerLimit("Minimum 200 words")).toBeNull();
		expect(answerLimit("Напишите не менее 100 слов")).toBeNull();
	});

	it.each([
		"Décrivez votre expérience en environ 100 mots",
		"Beschreibe deine Erfahrung in ungefähr 100 Wörtern",
		"Schreiben Sie etwa 100 Wörter",
		"Escriba alrededor de 100 palabras",
		"Describe tu experiencia en aproximadamente 100 palabras",
		"Descreva sua experiência em cerca de 100 palavras",
	])("does not treat an approximate length as a cap: %s", (question) => {
		expect(answerLimit(question)).toBeNull();
	});

	it("prefers the stated character cap over a parenthetical word conversion", () => {
		expect(answerLimit("Summarise in 300 characters (about 50 words)")).toEqual({
			kind: "characters",
			max: 300,
		});
		expect(answerLimit("Maximum 200 words or 1200 characters")).toEqual({ kind: "characters", max: 1200 });
	});

	it("keeps an ordinary 'about' out of the cap clause and honors a later maximum", () => {
		expect(answerLimit("Tell us about yourself (150 words max)")).toEqual({ kind: "words", max: 150 });
		expect(answerLimit("At least 100 words, no more than 200 words")).toEqual({ kind: "words", max: 200 });
	});

	it("reads Russian and Arabic units", () => {
		expect(answerLimit("Напишите 100 слов")).toEqual({ kind: "words", max: 100 });
		expect(answerLimit("اكتب 100 كلمة")).toEqual({ kind: "words", max: 100 });
	});
});
