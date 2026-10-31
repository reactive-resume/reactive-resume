import type { DocumentFilters, DocumentSummary } from "../../dto/documents";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { SQLWrapper } from "drizzle-orm";
import { and, arrayContains, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { application, coverLetter, resume } from "@reactive-resume/db/schema";

type ListInput = DocumentFilters & { userId: string; limit?: number | undefined; offset?: number | undefined };

// One projection and predicate for both kinds, counts and pages. Never select resume data or letter content.
function library(database: DbOrTx, input: ListInput) {
	// PostgreSQL current_timestamp stays fixed throughout the repeatable-read transaction.
	const cutoff = sql`current_timestamp - interval '30 days'`;
	const resumes = database
		.select({
			type: sql<"resume" | "letter">`'resume'`.as("type"),
			id: resume.id,
			name: resume.name,
			tags: resume.tags,
			isLocked: resume.isLocked,
			isPublic: resume.isPublic,
			slug: sql<string | null>`${resume.slug}`.as("slug"),
			trashedAt: resume.trashedAt,
			createdAt: resume.createdAt,
			updatedAt: resume.updatedAt,
			applicationId: sql<string | null>`${application.id}`.as("application_id"),
			company: application.company,
			role: application.role,
		})
		.from(resume)
		.leftJoin(application, and(eq(resume.applicationId, application.id), eq(application.userId, input.userId)))
		.where(
			and(eq(resume.userId, input.userId), input.trashed ? gte(resume.trashedAt, cutoff) : isNull(resume.trashedAt)),
		);
	const letters = database
		.select({
			type: sql<"resume" | "letter">`'letter'`.as("type"),
			id: coverLetter.id,
			name: coverLetter.name,
			tags: coverLetter.tags,
			isLocked: coverLetter.isLocked,
			isPublic: sql<boolean>`false`.as("is_public"),
			slug: sql<string | null>`null`.as("slug"),
			trashedAt: coverLetter.trashedAt,
			createdAt: coverLetter.createdAt,
			updatedAt: coverLetter.updatedAt,
			applicationId: sql<string | null>`${application.id}`.as("application_id"),
			company: application.company,
			role: application.role,
		})
		.from(coverLetter)
		.leftJoin(
			application,
			and(eq(coverLetter.sourceApplicationId, application.id), eq(application.userId, input.userId)),
		)
		.where(
			and(
				eq(coverLetter.userId, input.userId),
				input.trashed ? gte(coverLetter.trashedAt, cutoff) : isNull(coverLetter.trashedAt),
			),
		);
	return resumes.unionAll(letters).as("documents");
}

function predicate(rows: ReturnType<typeof library>, input: ListInput, includeType = true) {
	const q = input.q.trim();
	// strpos treats %, _ and backslashes literally, matching the existing substring search.
	const contains = (value: SQLWrapper) => sql`strpos(lower(${value}), lower(${q})) > 0`;
	return and(
		includeType && input.type !== "all" ? eq(rows.type, input.type) : undefined,
		input.public ? eq(rows.isPublic, true) : undefined,
		input.tags.length ? arrayContains(rows.tags, input.tags) : undefined,
		q
			? or(
					contains(rows.name),
					contains(rows.company),
					contains(rows.role),
					sql`exists (select 1 from unnest(${rows.tags}) tag where strpos(lower(tag), lower(${q})) > 0)`,
				)
			: undefined,
	);
}

async function readDocuments(database: DbOrTx, input: ListInput) {
	const rows = library(database, input);
	const where = predicate(rows, input);
	const order =
		input.sort === "name"
			? asc(sql`lower(${rows.name})`)
			: desc(input.sort === "created" ? rows.createdAt : rows.updatedAt);
	const query = database.select().from(rows).where(where).orderBy(order, asc(rows.type), asc(rows.id)).$dynamic();
	const paginated = input.limit !== undefined || input.offset !== undefined;
	const items = await (paginated ? query.limit(input.limit ?? 20).offset(input.offset ?? 0) : query);
	const totals = paginated
		? await database
				.select({ total: sql<number>`count(*)::int` })
				.from(rows)
				.where(where)
		: undefined;
	return {
		items: items.map(({ applicationId, company, role, ...row }): DocumentSummary => ({
			...row,
			application: applicationId ? { id: applicationId, company: company ?? "", role: role ?? "" } : null,
		})),
		total: totals?.[0]?.total ?? items.length,
	};
}

async function documentFacets(database: DbOrTx, input: ListInput) {
	const rows = library(database, input);
	const counts = await database
		.select({ type: rows.type, total: sql<number>`count(*)::int` })
		.from(rows)
		.where(predicate(rows, input, false))
		.groupBy(rows.type);
	// Tag discovery follows search, not the current page/type/tag selection. Search can find any tag.
	const tagRows = database
		.select({ tag: sql<string>`unnest(${rows.tags})`.as("tag") })
		.from(rows)
		.as("document_tags");
	const tags = await database
		.selectDistinct({ tag: tagRows.tag })
		.from(tagRows)
		.where(
			and(
				sql`btrim(${tagRows.tag}) <> ''`,
				input.q.trim() ? sql`strpos(lower(${tagRows.tag}), lower(${input.q.trim()})) > 0` : undefined,
			),
		)
		.orderBy(sql`tag`)
		.limit(100);
	const publicRows = await database.select({ id: rows.id }).from(rows).where(eq(rows.isPublic, true)).limit(1);
	return {
		counts: {
			resume: counts.find((row) => row.type === "resume")?.total ?? 0,
			letter: counts.find((row) => row.type === "letter")?.total ?? 0,
		},
		tags: [...new Set([...input.tags, ...tags.map((row) => row.tag)])],
		hasPublic: publicRows.length > 0,
	};
}

// Rows and filtered totals describe one database snapshot, including while another device edits the library.
export function listDocuments(input: ListInput) {
	return db.transaction((tx) => readDocuments(tx, input), {
		isolationLevel: "repeatable read",
		accessMode: "read only",
	});
}

export function listDocumentPage(input: ListInput) {
	return db.transaction(
		async (tx) => {
			const page = await readDocuments(tx, input);
			const facets = await documentFacets(tx, input);
			return { ...page, ...facets };
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
