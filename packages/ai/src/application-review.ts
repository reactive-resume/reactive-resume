import z from "zod";
import { aiOperationIdsSchema } from "@reactive-resume/schema/ai-usage";
import { careerWorkspaceSchema } from "@reactive-resume/schema/career";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { proposeEditsOutputSchema } from "./tools/agent-tool-contracts";

/** Also validates account-scoped recovery drafts; no API/database module enters either app. */
export const applicationReviewSchema = z.object({
	threadId: z.string().nullable(),
	generationStatus: z.enum(["ready", "interrupted"]),
	resume: z.object({
		id: z.string(),
		data: resumeDataSchema,
		updatedAt: z.coerce.date(),
		isLocked: z.boolean(),
		aiOperationIds: aiOperationIdsSchema.optional(),
	}),
	sets: z.array(
		proposeEditsOutputSchema.extend({
			messageId: z.string(),
			toolCallId: z.string(),
			aiOperationIds: aiOperationIdsSchema,
		}),
	),
	letter: z
		.object({
			document: z.object({
				id: z.string(),
				revision: z.number().int().positive(),
				content: z.string(),
				aiOperationIds: aiOperationIdsSchema.optional(),
			}),
			text: z.string(),
			aiOperationIds: aiOperationIdsSchema,
		})
		.nullable(),
	answers: z.array(
		z.object({
			question: z.string(),
			answer: careerWorkspaceSchema.shape.answers.element.pick({ answer: true, factIds: true, aiOperationIds: true }),
			note: z.string().nullable(),
		}),
	),
	failed: z.array(z.string()),
});
export type ApplicationReview = z.infer<typeof applicationReviewSchema>;
