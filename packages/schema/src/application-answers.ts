import z from "zod";
import { fnv1a } from "@reactive-resume/utils/string";

export const answerScopeSchema = z.enum(["reusable", "employer", "application"]);
export const answerEvidenceSchema = z.object({
	kind: z.enum(["fact", "story"]),
	id: z.string().min(1).max(255),
	revision: z.string().min(1).max(100),
});
export type AnswerEvidence = z.infer<typeof answerEvidenceSchema>;

/** Review belongs to this wording and scope; no save confirms a Knowledge fact or enables AI context. */
export const reviewedAnswerInputSchema = z
	.object({
		id: z.string().min(1).optional(),
		expectedRevision: z.number().int().positive().optional(),
		applicationId: z.string().min(1),
		question: z.string().trim().min(1).max(2000),
		answer: z.string().trim().min(1).max(6000),
		source: z.enum(["manual", "application", "ai-assisted"]),
		scope: answerScopeSchema,
		factIds: z.array(z.string().min(1)).max(10),
		storyIds: z.array(z.string().min(1)).max(10),
		expectedEvidence: z.array(answerEvidenceSchema).max(320),
		reviewed: z.literal(true),
		/** Required before intentionally making employer wording reusable elsewhere. */
		noEmployerWording: z.boolean(),
	})
	.refine((value) => value.scope !== "reusable" || value.noEmployerWording, {
		message: "Review and remove employer-specific wording before allowing reuse across employers.",
	});
export type ReviewedAnswerInput = z.infer<typeof reviewedAnswerInputSchema>;

export const reuseAnswerInputSchema = z.object({
	id: z.string().min(1),
	expectedRevision: z.number().int().positive(),
	applicationId: z.string().min(1),
	answer: z.string().trim().min(1).max(6000),
	reviewed: z.literal(true),
});

export const normalizeAnswerText = (value: string) =>
	value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();

/** Deterministic, local suggestions; never sends questions or answers to a provider. */
export function answerRelevance(question: string, query: string) {
	const normalized = normalizeAnswerText(query);
	if (!normalized) return 1;
	const candidate = normalizeAnswerText(question);
	if (candidate === normalized) return 2;
	if (candidate.includes(normalized)) return 1;
	const terms = new Set(normalized.match(/[\p{L}\p{N}]+/gu) ?? []);
	const words = new Set(candidate.match(/[\p{L}\p{N}]+/gu) ?? []);
	const matches = [...terms].filter((term) => words.has(term)).length;
	return matches / Math.max(terms.size, words.size, 1);
}

export function answerScopeAllows(
	answer: { scope: z.infer<typeof answerScopeSchema>; employer: string; applicationId: string | null },
	application: { id: string; company: string },
) {
	if (answer.scope === "application") return answer.applicationId === application.id;
	if (answer.scope === "employer")
		return normalizeAnswerText(answer.employer) === normalizeAnswerText(application.company);
	return true;
}

type EvidenceFact = {
	id: string;
	updatedAt: Date;
	text: string;
	category: string;
	status: string;
	applicationId: string | null;
	source: { kind: string; id: string; quote: string };
};
type EvidenceStory = {
	id: string;
	updatedAt: Date;
	applicationId: string | null;
	data: {
		title: string;
		situation: string;
		task: string;
		action: string;
		result: string;
		reflection: string;
		factIds: string[];
		tags: string[];
	};
};
// Timestamps alone miss two corrections within one millisecond. Content fingerprints detect that case too.
export const answerFactRevision = (fact: EvidenceFact) =>
	`${fact.updatedAt.toISOString()}:${fnv1a(JSON.stringify([fact.text, fact.category, fact.status, fact.applicationId, fact.source.kind, fact.source.id, fact.source.quote]))}`;
export const answerStoryRevision = (story: EvidenceStory) =>
	`${story.updatedAt.toISOString()}:${fnv1a(JSON.stringify([story.applicationId, story.data.title, story.data.situation, story.data.task, story.data.action, story.data.result, story.data.reflection, story.data.factIds, story.data.tags]))}`;

/** Includes facts backing selected stories, so correcting a story's evidence also invalidates review. */
export function reviewedAnswerEvidence(
	facts: EvidenceFact[],
	stories: EvidenceStory[],
	factIds: string[],
	storyIds: string[],
): AnswerEvidence[] {
	const selectedStories = stories.filter((story) => storyIds.includes(story.id));
	const ids = new Set([...factIds, ...selectedStories.flatMap((story) => story.data.factIds)]);
	return [
		...facts
			.filter((fact) => ids.has(fact.id))
			.map((fact) => ({ kind: "fact" as const, id: fact.id, revision: answerFactRevision(fact) })),
		...selectedStories.map((story) => ({
			kind: "story" as const,
			id: story.id,
			revision: answerStoryRevision(story),
		})),
	].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}
