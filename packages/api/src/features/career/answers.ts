import type { DbOrTx } from "@reactive-resume/db/client";
import type { ReviewedAnswerInput } from "@reactive-resume/schema/application-answers";
import type { reuseAnswerInputSchema } from "@reactive-resume/schema/application-answers";
import type z from "zod";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ORPCError } from "@orpc/client";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import {
	answerFactRevision,
	answerStoryRevision,
	answerScopeAllows,
	normalizeAnswerText,
	reviewedAnswerEvidence,
	reviewedAnswerInputSchema,
	reuseAnswerInputSchema as reuseSchema,
} from "@reactive-resume/schema/application-answers";
import { lockUser } from "../documents/ownership";

async function application(reader: DbOrTx, userId: string, id: string) {
	const [row] = await reader
		.select()
		.from(tables.application)
		.where(and(eq(tables.application.userId, userId), eq(tables.application.id, id)));
	if (!row) throw new ORPCError("NOT_FOUND");
	return row;
}
async function knowledge(reader: DbOrTx, userId: string) {
	const facts = await reader.select().from(tables.careerFact).where(eq(tables.careerFact.userId, userId));
	const stories = await reader.select().from(tables.careerStory).where(eq(tables.careerStory.userId, userId));
	return { facts, stories };
}
const visible = (id: string | null, applicationId: string | null) => id === null || id === applicationId;

function evidenceState(row: typeof tables.careerAnswer.$inferSelect, current: Awaited<ReturnType<typeof knowledge>>) {
	return row.evidence.map((ref) => {
		const fact =
			ref.kind === "fact" ? current.facts.find((fact) => fact.id === ref.id && fact.status === "active") : undefined;
		const story = ref.kind === "story" ? current.stories.find((story) => story.id === ref.id) : undefined;
		const item = fact ?? story;
		const stamp = fact ? answerFactRevision(fact) : story ? answerStoryRevision(story) : null;
		const status =
			!item || !visible(item.applicationId, row.applicationId)
				? ("removed" as const)
				: stamp !== ref.revision
					? ("changed" as const)
					: ("current" as const);
		return { ...ref, status };
	});
}

export const reviewedAnswers = {
	list: async (userId: string, applicationId: string) => {
		const target = await application(db, userId, applicationId);
		const rows = await db
			.select()
			.from(tables.careerAnswer)
			.where(eq(tables.careerAnswer.userId, userId))
			.orderBy(desc(tables.careerAnswer.reviewedAt));
		const current = await knowledge(db, userId);
		return rows.map((row) => {
			const evidence = evidenceState(row, current);
			const stale = evidence.some((ref) => ref.status !== "current");
			return { ...row, evidence, stale, canReuse: !stale && answerScopeAllows(row, target) };
		});
	},
	save: (userId: string, raw: ReviewedAnswerInput) => {
		const input = reviewedAnswerInputSchema.parse(raw);
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const target = await application(tx, userId, input.applicationId);
			const [existing] = input.id
				? await tx
						.select()
						.from(tables.careerAnswer)
						.where(and(eq(tables.careerAnswer.id, input.id), eq(tables.careerAnswer.userId, userId)))
				: [];
			if (input.id && !existing) throw new ORPCError("NOT_FOUND");
			if (existing && existing.revision !== input.expectedRevision)
				throw new ORPCError("CONFLICT", { message: "This saved answer changed. Reopen it before reviewing again." });
			if (existing && !answerScopeAllows(existing, target))
				throw new ORPCError("BAD_REQUEST", {
					message:
						"This answer is restricted to its employer or application. Open that application to edit it, or save a separately reviewed answer.",
				});
			const applicationId = input.scope === "application" ? target.id : null;
			const current = await knowledge(tx, userId);
			const selectedStories = current.stories.filter(
				(story) => input.storyIds.includes(story.id) && visible(story.applicationId, applicationId),
			);
			const factIds = [...new Set([...input.factIds, ...selectedStories.flatMap((story) => story.data.factIds)])];
			const selectedFacts = current.facts.filter(
				(fact) => factIds.includes(fact.id) && fact.status === "active" && visible(fact.applicationId, applicationId),
			);
			if (new Set(input.storyIds).size !== selectedStories.length || factIds.length !== selectedFacts.length)
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Choose current Knowledge evidence available to this scope. Reusable and employer answers can only link shared evidence.",
				});
			const evidence = reviewedAnswerEvidence(selectedFacts, selectedStories, input.factIds, input.storyIds);
			if (!isDeepStrictEqual(evidence, input.expectedEvidence))
				throw new ORPCError("CONFLICT", {
					message: "Supporting evidence changed. Reload and review it before saving.",
				});
			const duplicateKey = createHash("sha256")
				.update(
					JSON.stringify([
						normalizeAnswerText(input.question),
						input.scope,
						input.scope === "application"
							? target.id
							: input.scope === "employer"
								? normalizeAnswerText(target.company)
								: "",
					]),
				)
				.digest("hex");
			const [duplicate] = await tx
				.select()
				.from(tables.careerAnswer)
				.where(and(eq(tables.careerAnswer.userId, userId), eq(tables.careerAnswer.duplicateKey, duplicateKey)));
			if (duplicate && duplicate.id !== input.id)
				throw new ORPCError("CONFLICT", {
					message: "An answer for this question and scope already exists. Edit that saved answer instead.",
				});
			const values = {
				question: input.question,
				answer: input.answer,
				source: input.source,
				scope: input.scope,
				employer: target.company,
				applicationId,
				sourceApplicationId: existing?.sourceApplicationId ?? target.id,
				factIds: [...new Set(input.factIds)],
				storyIds: [...new Set(input.storyIds)],
				evidence,
				reviewedAt: new Date(),
				revision: (existing?.revision ?? 0) + 1,
				duplicateKey,
			};
			const [row] = existing
				? await tx.update(tables.careerAnswer).set(values).where(eq(tables.careerAnswer.id, existing.id)).returning()
				: await tx
						.insert(tables.careerAnswer)
						.values({ ...values, userId })
						.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			return row;
		});
	},
	/** Returns a reviewed copy; existing workspace CAS and submission owners retain all persistence. */
	reuse: (userId: string, raw: z.infer<typeof reuseAnswerInputSchema>) => {
		const input = reuseSchema.parse(raw);
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const target = await application(tx, userId, input.applicationId);
			const [row] = await tx
				.select()
				.from(tables.careerAnswer)
				.where(and(eq(tables.careerAnswer.userId, userId), eq(tables.careerAnswer.id, input.id)));
			if (!row) throw new ORPCError("NOT_FOUND");
			if (row.revision !== input.expectedRevision)
				throw new ORPCError("CONFLICT", { message: "This saved answer changed. Review its latest wording." });
			if (!answerScopeAllows(row, target))
				throw new ORPCError("BAD_REQUEST", {
					message:
						"This answer is restricted to its employer or application. Save a separately reviewed reusable answer first.",
				});
			if (evidenceState(row, await knowledge(tx, userId)).some((ref) => ref.status !== "current"))
				throw new ORPCError("CONFLICT", {
					message: "Supporting evidence changed or was removed. Review the saved answer first.",
				});
			return { text: input.answer, factIds: row.factIds };
		});
	},
	delete: (userId: string, id: string, expectedRevision: number) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.select()
				.from(tables.careerAnswer)
				.where(and(eq(tables.careerAnswer.userId, userId), eq(tables.careerAnswer.id, id)));
			if (!row) throw new ORPCError("NOT_FOUND");
			if (row.revision !== expectedRevision)
				throw new ORPCError("CONFLICT", { message: "This saved answer changed. Reopen it before deleting." });
			await tx.delete(tables.careerAnswer).where(eq(tables.careerAnswer.id, id));
		}),
};
