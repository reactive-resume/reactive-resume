import type { DbOrTx } from "@reactive-resume/db/client";
import type { SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import type { SelectResultFields } from "drizzle-orm/query-builders/select.types";
import { and, desc, eq, gt, inArray, isNull, like, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { slugify } from "@reactive-resume/utils/slug";
import { ownerIsNotBanned } from "./access-policy";

/** Lowercase letters and numbers, in groups joined by single dashes. Only new and changed slugs must match. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// After a rename the old address keeps working this long.
const REDIRECT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** `stem`, or `stem-2`, `stem-3`… whichever isn't taken. */
function pickFreeSlug(stem: string, taken: ReadonlySet<string>) {
	if (!taken.has(stem)) return stem;
	for (let suffix = 2; ; suffix++) {
		if (!taken.has(`${stem}-${suffix}`)) return `${stem}-${suffix}`;
	}
}

/** A slug made from `name` that none of the user's resumes uses yet. */
export async function findFreeSlug(client: DbOrTx, userId: string, name: string) {
	const stem = slugify(name) || "resume";
	const rows = await client
		.select({ slug: schema.resume.slug })
		.from(schema.resume)
		.where(
			and(eq(schema.resume.userId, userId), or(eq(schema.resume.slug, stem), like(schema.resume.slug, `${stem}-%`))),
		);

	return pickFreeSlug(stem, new Set(rows.map((row) => row.slug)));
}

/** Whether a slug can be this resume's address, and if not, why and what would work instead. */
export async function checkSlug(input: { userId: string; resumeId: string; slug: string }) {
	if (!SLUG_PATTERN.test(input.slug)) {
		const suggestion = slugify(input.slug);
		return { status: "invalid" as const, ...(suggestion && suggestion !== input.slug ? { suggestion } : {}) };
	}

	const [holder] = await db
		.select({ id: schema.resume.id, name: schema.resume.name })
		.from(schema.resume)
		.where(and(eq(schema.resume.userId, input.userId), eq(schema.resume.slug, input.slug)));

	if (!holder) return { status: "available" as const };
	if (holder.id === input.resumeId) return { status: "current" as const };

	return {
		status: "taken" as const,
		takenBy: holder.name,
		suggestion: await findFreeSlug(db, input.userId, input.slug),
	};
}

/**
 * Keeps the old address working for 30 days after a rename, and frees the new one from any older redirect: a
 * real resume's address always wins over a redirect.
 */
export async function recordSlugChange(
	client: DbOrTx,
	input: { userId: string; resumeId: string; from: string; to: string },
) {
	await client
		.delete(schema.resumeSlugRedirect)
		.where(and(eq(schema.resumeSlugRedirect.userId, input.userId), eq(schema.resumeSlugRedirect.slug, input.to)));

	const expiresAt = new Date(Date.now() + REDIRECT_LIFETIME_MS);
	await client
		.insert(schema.resumeSlugRedirect)
		.values({ userId: input.userId, resumeId: input.resumeId, slug: input.from, expiresAt })
		.onConflictDoUpdate({
			target: [schema.resumeSlugRedirect.userId, schema.resumeSlugRedirect.slug],
			set: { resumeId: input.resumeId, expiresAt },
		});
}

/** Matches a resume by its slug, or by a previous slug whose redirect hasn't expired. */
export function matchesSlug(slug: string) {
	return or(
		eq(schema.resume.slug, slug),
		inArray(
			schema.resume.id,
			db
				.select({ id: schema.resumeSlugRedirect.resumeId })
				.from(schema.resumeSlugRedirect)
				.where(
					and(
						eq(schema.resumeSlugRedirect.slug, slug),
						eq(schema.resumeSlugRedirect.userId, schema.resume.userId),
						gt(schema.resumeSlugRedirect.expiresAt, sql`now()`),
					),
				),
		),
	);
}

/**
 * The resume at `username`/`slug` (current slug or unexpired redirect), outside Trash, with an unbanned owner and
 * meeting any `extra` conditions. A resume's current slug wins over another's redirect.
 */
export async function findResumeBySlug<TColumns extends SelectedFields>(
	input: { username: string; slug: string },
	columns: TColumns,
	...extra: (SQL | undefined)[]
): Promise<SelectResultFields<TColumns> | undefined> {
	// Widened for the query builder, whose types can't follow a generic selection; the result is narrowed back.
	const [resume] = await db
		.select(columns as SelectedFields)
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(
			and(
				matchesSlug(input.slug),
				eq(schema.user.username, input.username),
				isNull(schema.resume.trashedAt),
				ownerIsNotBanned(),
				...extra,
			),
		)
		.orderBy(desc(sql`${schema.resume.slug} = ${input.slug}`))
		.limit(1);
	return resume as SelectResultFields<TColumns> | undefined;
}
