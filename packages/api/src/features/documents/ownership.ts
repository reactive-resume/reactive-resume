import type { DbOrTx } from "@reactive-resume/db/client";
import { ORPCError } from "@orpc/client";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";

/**
 * Locks the user's row so one user's writers run one at a time (owner first, before document or application writes)
 * without blocking foreign-key checks against it. NOT_FOUND when the user is gone.
 */
export async function lockUser(tx: DbOrTx, userId: string) {
	const [owner] = await tx
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.for("no key update");
	if (!owner) throw new ORPCError("NOT_FOUND");
}

/** Revalidate a document already selected for sharing, using the caller's owner-locked transaction. */
export async function assertDocumentVersion(
	reader: DbOrTx,
	userId: string,
	expected: { kind: "resume" | "letter"; id: string; updatedAt: Date },
) {
	const table = expected.kind === "resume" ? schema.resume : schema.coverLetter;
	const [current] = await reader
		.select({ updatedAt: table.updatedAt })
		.from(table)
		.where(and(eq(table.id, expected.id), eq(table.userId, userId), isNull(table.trashedAt)))
		.for("share");
	if (!current) throw new ORPCError("NOT_FOUND");
	if (current.updatedAt.getTime() !== expected.updatedAt.getTime())
		throw new ORPCError("CONFLICT", { message: "The selected document changed. Review it and try again." });
}

export async function assertSharedDocument(
	reader: DbOrTx,
	userId: string,
	expected: { source: { kind: string; id: string }; version: string },
) {
	const { kind, id } = expected.source;
	if (kind === "resume" || kind === "letter")
		return assertDocumentVersion(reader, userId, { kind, id, updatedAt: new Date(expected.version) });
	if (kind !== "resume-version" && kind !== "letter-version") throw new ORPCError("BAD_REQUEST");
	const table = kind === "resume-version" ? schema.resumeVersion : schema.coverLetterVersion;
	const [current] = await reader
		.select({ id: table.id })
		.from(table)
		.where(and(eq(table.id, id), eq(table.userId, userId)))
		.for("share");
	if (!current) throw new ORPCError("NOT_FOUND");
}
