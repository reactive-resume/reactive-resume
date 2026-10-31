import { createSelectSchema } from "drizzle-zod";
import z from "zod";
import * as tables from "@reactive-resume/db/schema";
import { answerEvidenceSchema, answerScopeSchema } from "@reactive-resume/schema/application-answers";
import {
	careerNoticeSchema,
	careerSourceSchema,
	careerStoryInputSchema,
	discoverySourceSchema,
	savedItemDataSchema,
} from "@reactive-resume/schema/career";

export const careerFactSchema = createSelectSchema(tables.careerFact, {
	source: careerSourceSchema,
	revisions: z.array(z.object({ text: z.string(), at: z.string() })),
}).extend({
	/** The application it's private to, by name; null for shared facts. */
	company: z.string().nullable(),
	/** Stories it backs and saved items that used it. */
	usedBy: z.object({ stories: z.number(), savedItems: z.number() }),
});
export const careerStorySchema = createSelectSchema(tables.careerStory, { data: careerStoryInputSchema });
export const savedItemSchema = createSelectSchema(tables.careerArtifact, {
	data: savedItemDataSchema,
	evidence: z.object({ factIds: z.array(z.string()), storyIds: z.array(z.string()) }),
});
export const careerScheduleSchema = createSelectSchema(tables.careerSchedule);
export const careerNotificationSchema = createSelectSchema(tables.careerNotification, {
	notice: careerNoticeSchema,
}).extend({
	/** Written from `notice` when it's read (English for now). */
	title: z.string(),
	body: z.string(),
});
export const careerOpportunitySchema = createSelectSchema(tables.careerOpportunity, {
	discoverySource: discoverySourceSchema.nullable(),
})
	.omit({ description: true })
	.extend({
		/** Target roles and locations from Preferences that the posting matches, in the user's words. */
		matches: z.array(z.string()),
		/** Partial word overlap with target roles; never an AI fit assessment. */
		keywordOverlap: z.array(z.string()).optional(),
		/** What the posting doesn't say. */
		unknowns: z.array(z.enum(["salary", "office"])),
	});

export const reviewedAnswerSchema = createSelectSchema(tables.careerAnswer, {
	scope: answerScopeSchema,
	source: z.enum(["manual", "application", "ai-assisted"]),
	factIds: z.array(z.string()),
	storyIds: z.array(z.string()),
	evidence: z.array(answerEvidenceSchema),
});
export const reviewedAnswerViewSchema = reviewedAnswerSchema.extend({
	evidence: z.array(answerEvidenceSchema.extend({ status: z.enum(["current", "changed", "removed"]) })),
	stale: z.boolean(),
	canReuse: z.boolean(),
});
