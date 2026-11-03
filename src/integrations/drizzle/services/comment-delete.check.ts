// Deleting a comment is not undoable, and it touches two things that are easy to get wrong: the
// replies hanging off it, and the one snapshot per review round that every before/after diff
// compares against. Needs a local database with a resume whose owner is an eng-labs user:
// node --env-file=.env --import tsx --test <this file>
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/integrations/drizzle/client";
import { resume, resumeComment, user } from "@/integrations/drizzle/schema";
import { getEngLabsUserByEmail } from "@/integrations/eng-labs";
import { createComment, createComments, deleteComment, getCommentsByResumeId } from "./resume-feedback.service";

/**
 * A real resume with a real eng-labs owner: `resume_comment` has foreign keys on the tenant and on
 * both actor columns, so invented ids never reach the delete logic this file is about.
 */
async function scratch() {
	const rows = await db
		.select({ id: resume.id, email: user.email })
		.from(resume)
		.innerJoin(user, eq(user.id, resume.userId));
	for (const row of rows) {
		const owner = await getEngLabsUserByEmail(row.email);
		if (owner?.tenantId) {
			return {
				base: { resumeId: row.id, studentId: owner.id, authorId: owner.id, tenantId: owner.tenantId },
			};
		}
	}
	throw new Error("no resume whose owner is an eng-labs user with a tenant");
}

/**
 * Only the rows this check created. Scoping the cleanup by author would delete the real feedback on
 * a real student's resume — the author here has to be a genuine eng-labs user for the FK's sake.
 */
async function sweep(ids: string[]) {
	if (ids.length > 0) await db.delete(resumeComment).where(inArray(resumeComment.id, ids));
}

/** The comments this check left on the resume, newest last, ignoring anyone else's. */
const mine = async (resumeId: string, ids: string[]) =>
	(await getCommentsByResumeId(resumeId)).filter((c) => ids.includes(c.id)).reverse();

test("a batch posts one comment each, and only the first carries the round's snapshot", async () => {
	const { base } = await scratch();
	let ids: string[] = [];
	try {
		const created = await createComments([
			{ ...base, content: "check: one", severity: "HIGH", anchor: { section: "projects" } },
			{ ...base, content: "check: two", severity: "LOW", anchor: { section: "projects" } },
			{ ...base, content: "check: three", severity: "MEDIUM", anchor: { section: "projects" } },
		]);
		ids = created.map((c) => c.id);

		assert.equal(created.length, 3, "each ticked suggestion is its own thread");
		assert.deepEqual(
			created.map((c) => c.severity),
			["HIGH", "LOW", "MEDIUM"],
			"each keeps the severity its checklist item carries",
		);
		assert.equal(created.filter((c) => c.snapshot).length, 1, "the snapshot belongs to the round, not the comment");
		assert.ok(created[0].snapshot, "and it is the first of the batch that carries it");
	} finally {
		await sweep(ids);
	}
});

test("deleting a comment takes its replies with it", async () => {
	const { base } = await scratch();
	let ids: string[] = [];
	try {
		const parent = await createComment({ ...base, content: "check: parent" });
		const one = await createComment({ ...base, content: "check: reply one", parentId: parent.id });
		const two = await createComment({ ...base, content: "check: reply two", parentId: parent.id });
		ids = [parent.id, one.id, two.id];

		await deleteComment(parent.id);

		assert.equal((await mine(base.resumeId, ids)).length, 0, "a reply with no thread is a row nothing can reach");
	} finally {
		await sweep(ids);
	}
});

test("deleting the comment that holds the snapshot hands it on instead of losing it", async () => {
	const { base } = await scratch();
	let ids: string[] = [];
	try {
		const [first, second] = await createComments([
			{ ...base, content: "check: first of the round" },
			{ ...base, content: "check: second of the round" },
		]);
		ids = [first.id, second.id];
		assert.ok(first.snapshot && !second.snapshot, "precondition: the first comment holds the copy");

		await deleteComment(first.id);

		const left = await mine(base.resumeId, ids);
		assert.equal(left.length, 1);
		assert.equal(left[0].id, second.id);
		assert.ok(left[0].snapshot, "the round keeps its baseline, so every other comment's diff still works");
	} finally {
		await sweep(ids);
	}
});

test("deleting the last comment of a round simply drops the snapshot", async () => {
	const { base } = await scratch();
	let ids: string[] = [];
	try {
		const only = await createComment({ ...base, content: "check: the only one" });
		ids = [only.id];
		await deleteComment(only.id);
		assert.equal(
			(await mine(base.resumeId, ids)).length,
			0,
			"nothing is left to hand it to, and nothing is left to need it",
		);
	} finally {
		await sweep(ids);
	}
});
