// The "Modified" column on the validation report counts students who edited after a reviewer sent
// their resume back, so the row must be written exactly once per revision request — and never while
// the student is simply drafting. Needs a local database with a resume whose owner is an eng-labs
// user: node --env-file=.env --import tsx --test <this file>
import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/integrations/drizzle/client";
import { resume, resumeHistory, user } from "@/integrations/drizzle/schema";
import { getEngLabsUserByEmail } from "@/integrations/eng-labs";
import { addToHistory, recordStudentEditAfterRevision } from "./resume-feedback.service";

async function ownedResume() {
	const resumes = await db
		.select({ id: resume.id, email: user.email })
		.from(resume)
		.innerJoin(user, eq(user.id, resume.userId));
	for (const r of resumes) {
		const student = await getEngLabsUserByEmail(r.email);
		if (student) return { r, student };
	}
	throw new Error("no resume whose owner is an eng-labs user");
}

/** Rows this check wrote, so a failure never leaves history dirtier than it found it. */
async function editsSince(resumeId: string, since: Date) {
	return db
		.select({ id: resumeHistory.id })
		.from(resumeHistory)
		.where(
			and(
				eq(resumeHistory.resumeId, resumeId),
				eq(resumeHistory.action, "RESUME_EDITED"),
				gte(resumeHistory.createdAt, since),
			),
		);
}

test("an edit while drafting is not recorded", async () => {
	const { r } = await ownedResume();
	const start = new Date();

	await recordStudentEditAfterRevision(r.id, "DRAFT");
	await recordStudentEditAfterRevision(r.id, "SUBMITTED_TO_FACULTY");
	await recordStudentEditAfterRevision(r.id, null);

	const rows = await editsSince(r.id, start);
	assert.equal(rows.length, 0, "no RESUME_EDITED row outside a revision request");
});

test("an edit after a revision request is recorded once, however many times the student saves", async () => {
	const { r, student } = await ownedResume();
	const start = new Date();

	const request = await addToHistory({
		resumeId: r.id,
		action: "FACULTY_REVISION_REQUESTED",
		changedBy: student.id,
		actorType: "INSTRUCTOR",
	});

	try {
		// The builder autosaves, so the same edit arrives repeatedly.
		await recordStudentEditAfterRevision(r.id, "FACULTY_REVISION_REQUESTED");
		await recordStudentEditAfterRevision(r.id, "FACULTY_REVISION_REQUESTED");
		await recordStudentEditAfterRevision(r.id, "FACULTY_REVISION_REQUESTED");

		const rows = await editsSince(r.id, start);
		assert.equal(rows.length, 1, "exactly one row for one revision request");

		// A second request opens a new cycle, so the next edit counts again.
		const second = await addToHistory({
			resumeId: r.id,
			action: "PO_REVISION_REQUESTED",
			changedBy: student.id,
			actorType: "PLACEMENT_OFFICER",
		});
		await recordStudentEditAfterRevision(r.id, "PO_REVISION_REQUESTED");

		const after = await editsSince(r.id, start);
		assert.equal(after.length, 2, "a new request is a new cycle");

		await db.delete(resumeHistory).where(eq(resumeHistory.id, second.id));
	} finally {
		await db.delete(resumeHistory).where(eq(resumeHistory.id, request.id));
		for (const row of await editsSince(r.id, start)) {
			await db.delete(resumeHistory).where(eq(resumeHistory.id, row.id));
		}
	}
});
