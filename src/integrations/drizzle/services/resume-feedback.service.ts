/**
 * Resume Feedback Service
 * Handles all database operations for resume comments, checklists, and evaluations
 */

import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { DEFAULT_RESUME_USER_ORG_ID } from "@/integrations/auth/config";
import { db } from "@/integrations/drizzle/client";
import {
	poSectionReview,
	resume,
	resumeChecklist,
	resumeChecklistItem,
	resumeComment,
	resumeEvaluation,
	resumeEvaluationItem,
	resumeHistory,
	reviewSnippet,
	user,
} from "@/integrations/drizzle/schema";
import { type CommentAnchor, type CommentSeverity, REVIEW_VERDICTS } from "@/schema/resume/comment-anchor";

/**
 * The resume as the reviewer is seeing it, when this comment opens a new review round.
 *
 * The Changes tab and each comment's before/after compare against this copy, so exactly one
 * comment per round carries it: the first one written since the student last edited. A reply
 * never opens a round.
 */
async function snapshotForNewRound(resumeId: string): Promise<typeof resume.$inferSelect.data | undefined> {
	const [[current], [last]] = await Promise.all([
		db.select({ data: resume.data, updatedAt: resume.updatedAt }).from(resume).where(eq(resume.id, resumeId)),
		db
			.select({ createdAt: resumeComment.createdAt })
			.from(resumeComment)
			.where(and(eq(resumeComment.resumeId, resumeId), isNotNull(resumeComment.snapshot)))
			.orderBy(desc(resumeComment.createdAt))
			.limit(1),
	]);
	return current && (!last || last.createdAt < current.updatedAt) ? current.data : undefined;
}

type NewComment = {
	resumeId: string;
	studentId: string;
	tenantId: string;
	authorId: string;
	content: string;
	scope?: "INDIVIDUAL" | "SECTION";
	parentId?: string;
	anchor?: CommentAnchor;
	severity?: CommentSeverity;
	suggestion?: string;
};

/**
 * CREATE: Add a comment to a resume
 */
export async function createComment(input: NewComment) {
	const [created] = await createComments([input]);
	return created;
}

/**
 * CREATE: Add several comments in one round trip.
 *
 * A reviewer sending the standard feedback for a section ticks three or four lines and posts them
 * together. They are separate rows rather than one merged comment so the student can mark each one
 * addressed on its own, and each keeps the severity its checklist item carries.
 *
 * One transaction, because a half-written batch would leave the student with part of the feedback
 * and the reviewer with no way to tell which part.
 */
export async function createComments(inputs: NewComment[]) {
	if (inputs.length === 0) return [];
	const { resumeId } = inputs[0];

	// The snapshot belongs to the round, not to each comment: taken once, before anything is
	// written, and carried by the first comment of the batch that is not a reply.
	const snapshot = inputs.some((input) => !input.parentId) ? await snapshotForNewRound(resumeId) : undefined;
	let snapshotTaken = false;

	return db.transaction(async (tx) => {
		const created = await tx
			.insert(resumeComment)
			.values(
				inputs.map((input) => {
					const carries = !!snapshot && !input.parentId && !snapshotTaken;
					if (carries) snapshotTaken = true;
					return {
						id: crypto.randomUUID(),
						resumeId: input.resumeId,
						studentId: input.studentId,
						tenantId: input.tenantId,
						organisationId: DEFAULT_RESUME_USER_ORG_ID,
						authorId: input.authorId,
						content: input.content,
						scope: input.scope ?? "INDIVIDUAL",
						parentId: input.parentId,
						anchor: input.anchor,
						severity: input.severity,
						suggestion: input.suggestion,
						snapshot: carries ? snapshot : undefined,
						status: "OPEN" as const,
						createdAt: new Date(),
						updatedAt: new Date(),
					};
				}),
			)
			.returning();

		// A reply to a thread the student already closed re-opens it: the feedback is ongoing.
		const parentIds = [...new Set(inputs.map((input) => input.parentId).filter((id): id is string => !!id))];
		if (parentIds.length > 0) {
			await tx
				.update(resumeComment)
				.set({ status: "OPEN", resolvedAt: null, updatedAt: new Date() })
				.where(and(inArray(resumeComment.id, parentIds), eq(resumeComment.resumeId, resumeId)));
		}

		return created;
	});
}

/**
 * UPDATE: Update a comment's status
 */
export async function updateCommentStatus(id: string, status: "OPEN" | "ADDRESSED" | "RESOLVED") {
	const resolvedAt = status === "RESOLVED" ? new Date() : null;

	const result = await db
		.update(resumeComment)
		.set({ status, resolvedAt, updatedAt: new Date() })
		.where(eq(resumeComment.id, id))
		.returning();

	return result[0];
}

/**
 * Comment bank: reusable review comments a tenant's reviewers wrote themselves, most used first.
 *
 * It no longer seeds a starter set. The six generic lines it used to plant ("Add more detail
 * here.") were never used — every one sat at zero — and they competed for the same space as the
 * section-scoped standard feedback in `review-suggestions.ts`, which tells a student what to
 * actually change. Deleting the rows was not enough on its own: this function re-seeded them on
 * the next page load, because it treated an empty bank as a tenant's first visit.
 */
export async function listSnippets(tenantId: string, _organisationId: string) {
	const rows = await db
		.select()
		.from(reviewSnippet)
		// `author_id` is null exactly on the old seeded rows and set on everything a reviewer saved,
		// so this retires the starter set wherever it was already planted without a data migration —
		// which this repo could not run anyway, since the schema lives in the eng-labs repo.
		.where(and(eq(reviewSnippet.tenantId, tenantId), isNotNull(reviewSnippet.authorId)));
	return rows.sort((a, b) => b.usageCount - a.usageCount || a.content.localeCompare(b.content));
}

export async function createSnippet(tenantId: string, organisationId: string, authorId: string, content: string) {
	await db.insert(reviewSnippet).values({ tenantId, organisationId, authorId, content }).onConflictDoNothing();
}

export async function deleteSnippet(tenantId: string, id: string) {
	await db.delete(reviewSnippet).where(and(eq(reviewSnippet.id, id), eq(reviewSnippet.tenantId, tenantId)));
}

export async function useSnippet(tenantId: string, id: string) {
	await db
		.update(reviewSnippet)
		.set({ usageCount: sql`${reviewSnippet.usageCount} + 1` })
		.where(and(eq(reviewSnippet.id, id), eq(reviewSnippet.tenantId, tenantId)));
}

export async function getCommentById(id: string) {
	const [comment] = await db.select().from(resumeComment).where(eq(resumeComment.id, id)).limit(1);
	return comment;
}

/**
 * READ: List comments for a resume
 */
export async function getCommentsByResumeId(resumeId: string) {
	const comments = await db
		.select()
		.from(resumeComment)
		.where(eq(resumeComment.resumeId, resumeId))
		.orderBy(desc(resumeComment.createdAt));

	return comments;
}

/**
 * UPDATE: Update a comment (status, content)
 */
export async function updateComment(
	commentId: string,
	updates: {
		content?: string;
		status?: "OPEN" | "ADDRESSED" | "RESOLVED";
		resolvedAt?: Date | null;
	},
) {
	const result = await db
		.update(resumeComment)
		.set({
			...updates,
			updatedAt: new Date(),
		})
		.where(eq(resumeComment.id, commentId))
		.returning();

	return result[0];
}

/**
 * DELETE: Remove a comment, and the thread hanging off it.
 *
 * A real delete, not a status change: a reviewer who posted on the wrong student wants it gone from
 * the student's feedback list, and RESOLVED already means "the student fixed this". Only the author
 * may call it — see the route — so a Placement Officer cannot quietly erase a faculty member's
 * feedback.
 *
 * Two things have to be handled before the row goes:
 *  - `parent_id` is a plain column with no cascade, so replies would survive as rows nothing links
 *    to. They are deleted with the comment that started the thread.
 *  - Exactly one comment per review round carries the `snapshot` the Changes tab and every
 *    before/after diff compare against. If that is the comment being deleted, the copy is handed to
 *    the oldest surviving comment of the round rather than lost — otherwise deleting one comment
 *    silently blanks the diff for all the others.
 */
export async function deleteComment(commentId: string) {
	return db.transaction(async (tx) => {
		const [doomed] = await tx.select().from(resumeComment).where(eq(resumeComment.id, commentId)).limit(1);
		if (!doomed) return null;

		if (doomed.snapshot && !doomed.parentId) {
			const [heir] = await tx
				.select({ id: resumeComment.id })
				.from(resumeComment)
				.where(
					and(
						eq(resumeComment.resumeId, doomed.resumeId),
						isNull(resumeComment.parentId),
						isNull(resumeComment.snapshot),
						// At or after, not strictly after: a batch of standard feedback is inserted inside one
						// millisecond, so the rest of the round shares this comment's timestamp to the precision
						// `created_at` stores. `>` would find no heir and silently drop the round's baseline.
						gte(resumeComment.createdAt, doomed.createdAt),
						ne(resumeComment.id, doomed.id),
					),
				)
				.orderBy(resumeComment.createdAt, resumeComment.id)
				.limit(1);
			if (heir) {
				await tx.update(resumeComment).set({ snapshot: doomed.snapshot }).where(eq(resumeComment.id, heir.id));
			}
		}

		await tx.delete(resumeComment).where(eq(resumeComment.parentId, commentId));
		await tx.delete(resumeComment).where(eq(resumeComment.id, commentId));
		return doomed;
	});
}

/**
 * CREATE: Create an evaluation checklist
 */
export async function createChecklist({
	facultyId,
	tenantId,
	courseId,
	title,
	description,
	items,
}: {
	facultyId: string;
	tenantId: string;
	courseId?: string;
	title: string;
	description?: string;
	items: Array<{
		title: string;
		description?: string;
		weight?: number;
		order?: number;
	}>;
}) {
	const checklistId = crypto.randomUUID();

	// Create checklist
	const checklistResult = await db
		.insert(resumeChecklist)
		.values({
			id: checklistId,
			facultyId,
			tenantId,
			organisationId: DEFAULT_RESUME_USER_ORG_ID,
			courseId,
			title,
			description,
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.returning();

	// Create items
	const itemsResult = await db
		.insert(resumeChecklistItem)
		.values(
			items.map((item, index) => ({
				id: crypto.randomUUID(),
				checklistId,
				title: item.title,
				description: item.description,
				weight: item.weight ?? 1.0,
				order: item.order ?? index,
				createdAt: new Date(),
				updatedAt: new Date(),
			})),
		)
		.returning();

	return {
		...checklistResult[0],
		items: itemsResult,
	};
}

/**
 * READ: Get checklist by ID with items
 */
export async function getChecklistById(checklistId: string) {
	const checklist = await db.select().from(resumeChecklist).where(eq(resumeChecklist.id, checklistId));

	if (!checklist.length) return null;

	const items = await db
		.select()
		.from(resumeChecklistItem)
		.where(eq(resumeChecklistItem.checklistId, checklistId))
		.orderBy(resumeChecklistItem.order);

	return {
		...checklist[0],
		items,
	};
}

/**
 * READ: List checklists by faculty or course
 */
export async function listChecklists({
	facultyId,
	facultyIds,
	courseId,
	tenantId,
}: {
	facultyId?: string;
	facultyIds?: string[];
	courseId?: string;
	tenantId: string;
}) {
	const conditions = [eq(resumeChecklist.tenantId, tenantId)];

	if (facultyId) {
		conditions.push(eq(resumeChecklist.facultyId, facultyId));
	}

	if (facultyIds && facultyIds.length > 0) {
		conditions.push(inArray(resumeChecklist.facultyId, facultyIds));
	}

	if (courseId) {
		conditions.push(eq(resumeChecklist.courseId, courseId));
	}

	return await db
		.select()
		.from(resumeChecklist)
		.where(and(...conditions));
}

/**
 * UPDATE: Deactivate a checklist
 */
export async function deactivateChecklist(checklistId: string) {
	const result = await db
		.update(resumeChecklist)
		.set({
			isActive: false,
			updatedAt: new Date(),
		})
		.where(eq(resumeChecklist.id, checklistId))
		.returning();

	return result[0];
}

/**
 * CREATE: Create or Update an evaluation
 */
export async function createEvaluation({
	resumeId,
	studentId,
	tenantId,
	checklistId,
	evaluatedBy,
	isAutoGenerated = false,
	items,
}: {
	resumeId: string;
	studentId: string;
	tenantId: string;
	checklistId: string;
	evaluatedBy: string;
	isAutoGenerated?: boolean;
	items: Array<{
		checklistItemId: string;
		passed: boolean;
		notes?: string;
		score?: number;
	}>;
}) {
	// Calculate overall score as weighted average:
	// overall = sum(itemScore * itemWeight) / sum(itemWeight)
	const checklistItemIds = [...new Set(items.map((item) => item.checklistItemId))];
	const checklistWeights =
		checklistItemIds.length > 0
			? await db
					.select({ id: resumeChecklistItem.id, weight: resumeChecklistItem.weight })
					.from(resumeChecklistItem)
					.where(
						and(eq(resumeChecklistItem.checklistId, checklistId), inArray(resumeChecklistItem.id, checklistItemIds)),
					)
			: [];
	const weightByItemId = new Map(checklistWeights.map((row) => [row.id, row.weight ?? 1]));
	let weightedScoreSum = 0;
	let totalWeight = 0;
	for (const item of items) {
		const weight = weightByItemId.get(item.checklistItemId) ?? 1;
		const score = item.score ?? 0;
		weightedScoreSum += score * weight;
		totalWeight += weight;
	}
	const overallScore = totalWeight > 0 ? weightedScoreSum / totalWeight : null;

	// Check if evaluation already exists for (resumeId, checklistId)
	const existing = await db
		.select()
		.from(resumeEvaluation)
		.where(and(eq(resumeEvaluation.resumeId, resumeId), eq(resumeEvaluation.checklistId, checklistId)))
		.limit(1);

	// Fetch current resume snapshot
	const resumeResult = await db.select().from(resume).where(eq(resume.id, resumeId)).limit(1);
	const snapshot = resumeResult.length > 0 ? resumeResult[0].data : null;

	let evaluationId: string;

	if (existing.length > 0) {
		evaluationId = existing[0].id;
		// Update existing evaluation
		await db
			.update(resumeEvaluation)
			.set({
				overallScore,
				isAutoGenerated,
				snapshot,
				evaluatedBy,
				evaluatedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(resumeEvaluation.id, evaluationId));

		// Delete existing items
		await db.delete(resumeEvaluationItem).where(eq(resumeEvaluationItem.evaluationId, evaluationId));
	} else {
		evaluationId = crypto.randomUUID();
		const refs = await resumeRefs(resumeId);
		// Create new evaluation
		await db.insert(resumeEvaluation).values({
			id: evaluationId,
			resumeId,
			studentId: refs.studentId ?? studentId,
			tenantId: refs.tenantId ?? tenantId,
			organisationId: refs.organisationId ?? DEFAULT_RESUME_USER_ORG_ID,
			checklistId,
			overallScore,
			isAutoGenerated,
			snapshot,
			evaluatedBy,
			evaluatedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	// Add to history
	await addToHistory({
		resumeId,
		studentId,
		tenantId,
		action: "EVALUATED",
		changedBy: evaluatedBy,
		actorType: "INSTRUCTOR",
		currentData: snapshot,
	});

	// Insert new evaluation items
	const itemsResult = await db
		.insert(resumeEvaluationItem)
		.values(
			items.map((item) => ({
				id: crypto.randomUUID(),
				evaluationId,
				checklistItemId: item.checklistItemId,
				passed: item.passed,
				notes: item.notes,
				score: item.score,
				createdAt: new Date(),
			})),
		)
		.returning();

	// Return the evaluation (either updated or new)
	const finalEval = await db.select().from(resumeEvaluation).where(eq(resumeEvaluation.id, evaluationId));

	return {
		...finalEval[0],
		items: itemsResult,
	};
}

/**
 * READ: Get evaluation by ID with items
 */
export async function getEvaluationById(evaluationId: string) {
	const evaluation = await db.select().from(resumeEvaluation).where(eq(resumeEvaluation.id, evaluationId));

	if (!evaluation.length) return null;

	const items = await db.select().from(resumeEvaluationItem).where(eq(resumeEvaluationItem.evaluationId, evaluationId));

	return {
		...evaluation[0],
		items,
	};
}

/**
 * READ: List evaluations for a resume
 */
export async function getEvaluationsByResumeId(resumeId: string) {
	const evaluations = await db
		.select()
		.from(resumeEvaluation)
		.where(eq(resumeEvaluation.resumeId, resumeId))
		.orderBy(desc(resumeEvaluation.evaluatedAt));

	// Fetch items for each evaluation
	const evaluationsWithItems = await Promise.all(
		evaluations.map(async (evaluation) => {
			const items = await db
				.select()
				.from(resumeEvaluationItem)
				.where(eq(resumeEvaluationItem.evaluationId, evaluation.id));

			return {
				...evaluation,
				items,
			};
		}),
	);

	return evaluationsWithItems;
}

/**
 * CREATE: Add to resume history audit trail
 */
/**
 * On the platform database a row's tenant, organisation and student are foreign keys to eng-labs rows: take them from
 * the resume and its owner. Callers' values are only the fallback when the owner is not an eng-labs user.
 */
async function resumeRefs(resumeId: string) {
	const { getEngLabsUserByEmail } = await import("@/integrations/eng-labs");
	const [owner] = await db
		.select({ tenantId: resume.tenantId, organisationId: resume.organisationId, email: user.email })
		.from(resume)
		.innerJoin(user, eq(user.id, resume.userId))
		.where(eq(resume.id, resumeId))
		.limit(1);
	const student = owner && (await getEngLabsUserByEmail(owner.email));
	return { tenantId: owner?.tenantId, organisationId: owner?.organisationId, studentId: student?.id };
}

/**
 * What a history row records.
 *
 * Every stage of the workflow gets its own action. Three used to share one with something else,
 * which made the validation reports impossible to compute: a faculty revision request was written
 * as the generic "UPDATED", a PO verification was written as "FACULTY_VERIFIED" — so the PO's work
 * was filed under faculty — and "SUBMITTED_TO_PO" was written despite not being a member of this
 * union at all, which only type-checked because the call sites cast it away.
 */
export type ResumeHistoryAction =
	| "CREATED"
	| "UPDATED"
	/** The student edited the resume after a reviewer sent it back. Drives the "Modified" report. */
	| "RESUME_EDITED"
	| "COMMENTED"
	| "EVALUATED"
	| "FORWARDED"
	| "SUBMITTED"
	| "FACULTY_REVISION_REQUESTED"
	| "FACULTY_VERIFIED"
	| "FINALIZED"
	| "SUBMITTED_TO_PO"
	| "PO_REVISION_REQUESTED"
	| "PO_VERIFIED"
	| "PO_APPROVED"
	| "PO_REJECTED"
	| "RESUBMITTED";

export async function addToHistory({
	resumeId,
	studentId,
	tenantId,
	action,
	changedBy,
	actorType,
	previousData,
	currentData,
}: {
	resumeId: string;
	studentId?: string;
	tenantId?: string;
	action: ResumeHistoryAction;
	changedBy: string;
	actorType: "LEARNER" | "INSTRUCTOR" | "PLACEMENT_OFFICER" | "ADMIN";
	previousData?: unknown;
	currentData?: unknown;
}) {
	const refs = await resumeRefs(resumeId);
	const result = await db
		.insert(resumeHistory)
		.values({
			resumeId,
			studentId: refs.studentId ?? studentId ?? "unknown",
			tenantId: refs.tenantId ?? tenantId ?? "default",
			organisationId: refs.organisationId ?? DEFAULT_RESUME_USER_ORG_ID,
			action,
			changedBy,
			actorType,
			previousData,
			currentData,
			createdAt: new Date(),
		})
		.returning();

	return result[0];
}

/** The stages that mean the resume is back with the student, waiting on them to make changes. */
const REVISION_REQUESTED_STATUSES = ["FACULTY_REVISION_REQUESTED", "PO_REVISION_REQUESTED"];

/**
 * Record that the student acted on a reviewer's revision request.
 *
 * This is the only source for the "Modified" column on the validation report: nothing else writes a
 * row when a student edits, so without this the report can only ever read zero.
 *
 * Two things keep the signal clean. It fires only while the resume sits in a revision-requested
 * stage, so ordinary drafting is not recorded; and only once per request, because the builder
 * autosaves and a row per keystroke would bury the event it is meant to mark.
 *
 * `changed_by` is a foreign key to the eng-labs `users` table, so it needs the eng-labs id — the
 * caller's session carries a Better Auth id, which would fail the constraint. The resume owner's
 * eng-labs row is resolved by email here; when there is none, nothing is written. A student saving
 * their own resume must never fail because an audit row could not be.
 */
export async function recordStudentEditAfterRevision(resumeId: string, reviewStatus: string | null) {
	if (!reviewStatus || !REVISION_REQUESTED_STATUSES.includes(reviewStatus)) return;

	const [lastRequest] = await db
		.select({ createdAt: resumeHistory.createdAt })
		.from(resumeHistory)
		.where(and(eq(resumeHistory.resumeId, resumeId), inArray(resumeHistory.action, REVISION_REQUESTED_STATUSES)))
		.orderBy(desc(resumeHistory.createdAt))
		.limit(1);
	if (!lastRequest) return;

	const [alreadyLogged] = await db
		.select({ id: resumeHistory.id })
		.from(resumeHistory)
		.where(
			and(
				eq(resumeHistory.resumeId, resumeId),
				eq(resumeHistory.action, "RESUME_EDITED"),
				gt(resumeHistory.createdAt, lastRequest.createdAt),
			),
		)
		.limit(1);
	if (alreadyLogged) return;

	const refs = await resumeRefs(resumeId);
	if (!refs.studentId) return;

	await addToHistory({
		resumeId,
		action: "RESUME_EDITED",
		changedBy: refs.studentId,
		actorType: "LEARNER",
	});
}

/**
 * UPDATE: Update resume review status and record history
 */
export async function updateResumeStatus({
	resumeId,
	studentId,
	tenantId,
	status,
	changedBy,
	actorType,
	isLocked: explicitIsLocked,
}: {
	resumeId: string;
	studentId?: string;
	tenantId?: string;
	status:
		| "DRAFT"
		| "SUBMITTED_TO_FACULTY"
		| "FACULTY_REVISION_REQUESTED"
		| "FACULTY_VERIFIED"
		| "FINALIZED_BY_FACULTY"
		| "SUBMITTED_TO_PO"
		| "PO_REVISION_REQUESTED"
		| "RESUBMITTED_TO_PO"
		| "PO_VERIFIED"
		| "APPROVED";
	changedBy: string;
	actorType: "LEARNER" | "INSTRUCTOR" | "PLACEMENT_OFFICER" | "ADMIN";
	isLocked?: boolean;
}) {
	// Decide default locking based on status if not explicitly provided
	let lockValue = explicitIsLocked;
	if (lockValue === undefined) {
		const lockStatuses = ["FACULTY_VERIFIED", "FINALIZED_BY_FACULTY", "SUBMITTED_TO_PO", "PO_VERIFIED", "APPROVED"];
		const unlockStatuses = ["DRAFT", "FACULTY_REVISION_REQUESTED", "PO_REVISION_REQUESTED"];

		if (lockStatuses.includes(status)) lockValue = true;
		if (unlockStatuses.includes(status)) lockValue = false;
	}

	const result = await db
		.update(resume)
		.set({
			reviewStatus: status,
			isLocked: lockValue,
			updatedAt: new Date(),
		})
		.where(eq(resume.id, resumeId))
		.returning();

	// Map status to history action
	const actionMap: Record<string, ResumeHistoryAction> = {
		SUBMITTED_TO_FACULTY: "SUBMITTED",
		FACULTY_REVISION_REQUESTED: "FACULTY_REVISION_REQUESTED",
		FACULTY_VERIFIED: "FACULTY_VERIFIED",
		FINALIZED_BY_FACULTY: "FINALIZED",
		SUBMITTED_TO_PO: "SUBMITTED_TO_PO",
		PO_REVISION_REQUESTED: "PO_REVISION_REQUESTED",
		RESUBMITTED_TO_PO: "RESUBMITTED",
		PO_VERIFIED: "PO_VERIFIED",
		APPROVED: "PO_APPROVED",
	};

	if (actionMap[status]) {
		await addToHistory({
			resumeId,
			studentId,
			tenantId,
			action: actionMap[status],
			changedBy,
			actorType,
			// A verdict keeps a copy of the resume as reviewed, so the next review can show what changed.
			currentData: status in REVIEW_VERDICTS ? result[0]?.data : undefined,
		});
	}

	return result[0];
}

/**
 * UPDATE: Bulk update status for an entire section
 * Used by Faculty to "Finalize Section" after individual reviews
 */
export async function bulkUpdateSectionResumes({
	resumes,
	tenantId,
	toStatus,
	changedBy,
	actorType,
}: {
	resumes: Array<{ id: string; studentId: string }>;
	tenantId: string;
	toStatus:
		| "DRAFT"
		| "SUBMITTED_TO_FACULTY"
		| "FACULTY_REVISION_REQUESTED"
		| "FACULTY_VERIFIED"
		| "FINALIZED_BY_FACULTY"
		| "SUBMITTED_TO_PO"
		| "PO_REVISION_REQUESTED"
		| "RESUBMITTED_TO_PO"
		| "PO_VERIFIED"
		| "APPROVED";
	changedBy: string;
	actorType: "INSTRUCTOR" | "PLACEMENT_OFFICER" | "ADMIN";
}) {
	const resumeIds = resumes.map((r) => r.id);

	// Decide locking based on status
	const lockStatuses = ["FACULTY_VERIFIED", "FINALIZED_BY_FACULTY", "SUBMITTED_TO_PO", "PO_VERIFIED", "APPROVED"];
	const isLocked = lockStatuses.includes(toStatus);

	// 1. Update all resumes
	const results = await db
		.update(resume)
		.set({
			reviewStatus: toStatus,
			isLocked,
			updatedAt: new Date(),
		})
		.where(inArray(resume.id, resumeIds))
		.returning();

	// 2. Map status to history action
	const actionMap: Record<string, ResumeHistoryAction> = {
		SUBMITTED_TO_FACULTY: "SUBMITTED",
		FACULTY_REVISION_REQUESTED: "FACULTY_REVISION_REQUESTED",
		FACULTY_VERIFIED: "FACULTY_VERIFIED",
		FINALIZED_BY_FACULTY: "FINALIZED",
		SUBMITTED_TO_PO: "SUBMITTED_TO_PO",
		PO_REVISION_REQUESTED: "PO_REVISION_REQUESTED",
		RESUBMITTED_TO_PO: "RESUBMITTED",
		PO_VERIFIED: "PO_VERIFIED",
		APPROVED: "PO_APPROVED",
	};

	// 3. Record history for each (Drizzle doesn't support bulk insert with different values easily if we want to reuse addToHistory)
	// But we can do a bulk insert into resumeHistory directly.
	if (actionMap[toStatus]) {
		await db.insert(resumeHistory).values(
			resumes.map((r) => ({
				id: crypto.randomUUID(),
				resumeId: r.id,
				studentId: r.studentId,
				tenantId,
				organisationId: DEFAULT_RESUME_USER_ORG_ID,
				action: actionMap[toStatus],
				changedBy,
				actorType,
				createdAt: new Date(),
			})),
		);
	}

	return results;
}

/**
 * UPDATE: Explicitly toggle lock on a resume
 */
export async function toggleLock({
	resumeId,
	isLocked,
	reason,
}: {
	resumeId: string;
	isLocked: boolean;
	reason?: string;
}) {
	const result = await db
		.update(resume)
		.set({
			isLocked,
			unlockReason: isLocked ? null : reason,
			updatedAt: new Date(),
		})
		.where(eq(resume.id, resumeId))
		.returning();

	return result[0];
}

/**
 * READ: Get resume history timeline
 */
export async function getResumeHistory(resumeId: string) {
	const history = await db
		.select()
		.from(resumeHistory)
		.where(eq(resumeHistory.resumeId, resumeId))
		.orderBy(desc(resumeHistory.createdAt));

	return history;
}

/**
 * READ: Get history for a student across all resumes
 */
export async function getStudentHistory(studentId: string, tenantId: string) {
	const history = await db
		.select()
		.from(resumeHistory)
		.where(and(eq(resumeHistory.studentId, studentId), eq(resumeHistory.tenantId, tenantId)))
		.orderBy(desc(resumeHistory.createdAt));

	return history;
}

// ─────────────────────────────────────────────────────────────────────────────
// PO Section Review
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CREATE: Record a PO's section-level review feedback.
 * Call this BEFORE bulk-setting the resumes back to FINALIZED_BY_FACULTY.
 */
export async function createPoSectionReview({
	sectionId,
	tenantId,
	facultyId,
	poId,
	reviewNotes,
	voiceNoteUrl,
	resumeIds,
}: {
	sectionId: string;
	tenantId: string;
	facultyId?: string;
	poId: string;
	reviewNotes: string;
	voiceNoteUrl?: string;
	resumeIds: string[];
}) {
	const result = await db
		.insert(poSectionReview)
		.values({
			id: crypto.randomUUID(),
			sectionId,
			tenantId,
			organisationId: DEFAULT_RESUME_USER_ORG_ID,
			facultyId: facultyId ?? null,
			poId,
			reviewNotes,
			voiceNoteUrl: voiceNoteUrl ?? null,
			resumeIds,
			createdAt: new Date(),
		})
		.returning();

	return result[0];
}

/**
 * UPDATE: Edit an existing PO section review (notes and/or voice note).
 */
export async function updatePoSectionReview(
	id: string,
	{ reviewNotes, voiceNoteUrl }: { reviewNotes: string; voiceNoteUrl?: string | null },
) {
	const result = await db
		.update(poSectionReview)
		.set({
			reviewNotes,
			voiceNoteUrl: voiceNoteUrl ?? null,
		})
		.where(eq(poSectionReview.id, id))
		.returning();

	return result[0];
}

/**
 * READ: Get PO section reviews for a given section, newest first.
 */
export async function getPoSectionReviews(sectionId: string, tenantId: string) {
	return db
		.select()
		.from(poSectionReview)
		.where(and(eq(poSectionReview.sectionId, sectionId), eq(poSectionReview.tenantId, tenantId)))
		.orderBy(desc(poSectionReview.createdAt));
}
