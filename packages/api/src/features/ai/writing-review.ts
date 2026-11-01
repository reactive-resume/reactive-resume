import { ORPCError } from "@orpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { resume, resumeWritingReview } from "@reactive-resume/db/schema";
import { lockUser } from "../documents/ownership";
import { atsReviewOutputSchema } from "./ats-review";

async function requireReviewResume(userId: string, id: string) {
	const [owned] = await db
		.select({ id: resume.id, updatedAt: resume.updatedAt })
		.from(resume)
		.where(and(eq(resume.id, id), eq(resume.userId, userId), isNull(resume.trashedAt)));
	if (!owned) throw new ORPCError("NOT_FOUND");
	return owned;
}

export async function readWritingReview(userId: string, resumeId: string) {
	await requireReviewResume(userId, resumeId);
	const [row] = await db
		.select()
		.from(resumeWritingReview)
		.where(and(eq(resumeWritingReview.resumeId, resumeId), eq(resumeWritingReview.userId, userId)));
	return row?.review && row.inputText !== null && row.passages && row.reviewedAt
		? {
				inputText: row.inputText,
				passages: row.passages,
				review: atsReviewOutputSchema.parse(row.review),
				reviewedAt: row.reviewedAt,
			}
		: null;
}

/** Reserve an ordered request without removing the last completed review. */
export function beginWritingReview(userId: string, resumeId: string) {
	return db.transaction(async (tx) => {
		await lockUser(tx, userId);
		const [owned] = await tx
			.select({ id: resume.id, updatedAt: resume.updatedAt })
			.from(resume)
			.where(and(eq(resume.id, resumeId), eq(resume.userId, userId), isNull(resume.trashedAt)))
			.for("share");
		if (!owned) throw new ORPCError("NOT_FOUND");
		const [request] = await tx
			.insert(resumeWritingReview)
			.values({ resumeId, userId })
			.onConflictDoUpdate({
				target: resumeWritingReview.resumeId,
				set: { requestGeneration: sql`${resumeWritingReview.requestGeneration}+1` },
			})
			.returning({ generation: resumeWritingReview.requestGeneration });
		if (!request) throw new Error("Writing request was not reserved.");
		return { ...owned, generation: request.generation };
	});
}

export async function saveWritingReview(
	input: typeof resumeWritingReview.$inferInsert & { requestGeneration: number; reviewedAt: Date },
) {
	await db.transaction(async (tx) => {
		await lockUser(tx, input.userId);
		const [owned] = await tx
			.select({ id: resume.id })
			.from(resume)
			.where(and(eq(resume.id, input.resumeId), eq(resume.userId, input.userId), isNull(resume.trashedAt)))
			.for("share");
		if (!owned) throw new ORPCError("NOT_FOUND");
		await tx
			.update(resumeWritingReview)
			.set({
				...input,
				reviewedAt: sql`greatest(${input.reviewedAt}, ${resumeWritingReview.reviewedAt} + interval '1 millisecond')`,
			})
			.where(
				and(
					eq(resumeWritingReview.resumeId, input.resumeId),
					eq(resumeWritingReview.userId, input.userId),
					eq(resumeWritingReview.requestGeneration, input.requestGeneration),
				),
			);
	});
}
