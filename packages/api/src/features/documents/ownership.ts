import type { DbOrTx } from "@reactive-resume/db/client";
import { createHash } from "node:crypto";
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

/** The same JSON with object keys sorted, so one request always gives one fingerprint. */
const canonical = (value: unknown): unknown =>
	value instanceof Date
		? value.toISOString()
		: Array.isArray(value)
			? value.map(canonical)
			: value && typeof value === "object"
				? Object.fromEntries(
						Object.entries(value)
							.filter(([, entry]) => entry !== undefined)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([key, entry]) => [key, canonical(entry)]),
					)
				: value;

const fingerprintOf = (request: unknown) =>
	createHash("sha256")
		.update(JSON.stringify(canonical(request)))
		.digest("hex");

type CreatedRow = { table: "resume" | "application"; id: string; userId: string; request: unknown };

/** Refusal of a client-chosen ID: it isn't free, and this request isn't the one that took it. */
export const idInUse = () =>
	new ORPCError("CONFLICT", { message: "This ID is already in use. Choose another ID and try again." });

/**
 * Whether a row with this client-chosen ID was already saved by this same request: a retry after a lost response, a
 * second press or a remounted screen, which gets that row back. Resumes and applications share one ID space here. Any
 * other use is refused, without saying which: an ID another account holds, one a resume or application was saved
 * under some other way, one a different request took, or one whose row this request saved but has since been deleted
 * or moved to Trash, so a reused ID never returns, links, changes or brings back a row.
 */
export async function isRetriedCreate(tx: DbOrTx, { table, id, userId, request }: CreatedRow) {
	const [resume] = await tx
		.select({ userId: schema.resume.userId, trashedAt: schema.resume.trashedAt })
		.from(schema.resume)
		.where(eq(schema.resume.id, id));
	const [application] = await tx
		.select({ userId: schema.application.userId })
		.from(schema.application)
		.where(eq(schema.application.id, id));
	const [receipt] = await tx
		.select({ userId: schema.createRequest.userId, fingerprint: schema.createRequest.fingerprint })
		.from(schema.createRequest)
		.where(eq(schema.createRequest.id, id));
	if (!resume && !application && !receipt) return false;

	// A receipted ID was free in both tables when its row was saved, so only that row can hold it.
	const row = table === "resume" ? resume : application;
	const sameRequest = receipt?.userId === userId && receipt.fingerprint === fingerprintOf(request);
	if (row && row.userId === userId && sameRequest && !resume?.trashedAt) return true;
	throw idInUse();
}

/**
 * Records the request a row was saved by, in the row's own transaction. Another receipt for the ID (a request racing
 * this one) fails the transaction, row and all.
 */
export async function recordCreateRequest(tx: DbOrTx, { id, userId, request }: Omit<CreatedRow, "table">) {
	const [receipt] = await tx
		.insert(schema.createRequest)
		.values({ id, userId, fingerprint: fingerprintOf(request) })
		.onConflictDoNothing({ target: schema.createRequest.id })
		.returning({ id: schema.createRequest.id });
	if (!receipt) throw idInUse();
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
