import type { DbOrTx } from "@reactive-resume/db/client";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { ORPCError } from "@orpc/client";
import { and, desc, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";

// An editing session's autosave is refreshed at most this often.
const SESSION_REFRESH_MS = 2 * 60 * 1000;
// Expiring kinds (autosaves, restore markers, AI edits) are kept this long; the rest stay until deleted.
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
// A safety cap on autosaves per document, so storage stays bounded however often it's edited.
const MAX_AUTOSAVES = 500;
// Bound recent expiring versions; permanent checkpoints always remain discoverable.
const LIST_LIMIT = 100;

type VersionSummary<TKind extends string> = { id: string; kind: TKind; name: string | null; createdAt: Date };

type VersionTable = {
	table: PgTable;
	id: PgColumn;
	/** The document the version belongs to (`resumeId`, `coverLetterId`). */
	document: PgColumn;
	documentKey: string;
	userId: PgColumn;
	data: PgColumn;
	kind: PgColumn;
	name: PgColumn;
	sessionId: PgColumn;
	createdAt: PgColumn;
};

type Owned = { documentId: string; userId: string };

/**
 * History for one kind of document (resumes, letters): versions are written with a kind, autosaves collapse into one
 * per editing session, expiring kinds age out after 90 days, and only named versions can be renamed or deleted.
 * Retention runs whenever a version is written, so it needs no scheduler.
 */
export function createVersionHistory<TKind extends string, TData>(config: {
	versions: VersionTable;
	/** The document table, for the ownership check before listing. */
	owner: { table: PgTable; id: PgColumn; userId: PgColumn };
	expiringKinds: readonly TKind[];
	/** Every write stores data through this (validation, normalisation). */
	toStored: (data: TData) => unknown;
	label: string;
}) {
	const v = config.versions;
	const summary = { id: v.id, kind: v.kind, name: v.name, createdAt: v.createdAt };
	const ownedVersion = (input: Owned & { versionId: string }) =>
		and(eq(v.id, input.versionId), eq(v.document, input.documentId), eq(v.userId, input.userId));

	async function prune(client: DbOrTx, documentId: string) {
		await client
			.delete(v.table)
			.where(
				and(
					eq(v.document, documentId),
					inArray(v.kind, [...config.expiringKinds]),
					lt(v.createdAt, new Date(Date.now() - RETENTION_MS)),
				),
			);

		const newestAutosaves = client
			.select({ id: v.id })
			.from(v.table)
			.where(and(eq(v.document, documentId), eq(v.kind, "auto")))
			.orderBy(desc(v.createdAt))
			.limit(MAX_AUTOSAVES);

		await client
			.delete(v.table)
			.where(and(eq(v.document, documentId), eq(v.kind, "auto"), notInArray(v.id, newestAutosaves)));
	}

	async function write(
		client: DbOrTx,
		input: Owned & { data: TData; kind: TKind; name?: string | null | undefined; sessionId?: string | undefined },
	) {
		const [version] = await client
			.insert(v.table)
			.values({
				[v.documentKey]: input.documentId,
				userId: input.userId,
				data: config.toStored(input.data),
				kind: input.kind,
				name: input.name ?? null,
				sessionId: input.sessionId ?? null,
			} as never)
			.returning(summary);
		if (!version) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to save the version." });

		await prune(client, input.documentId);
		return version as VersionSummary<TKind>;
	}

	return {
		write,

		/**
		 * The autosave path. Each editing session keeps one version holding its latest state, refreshed at most every
		 * two minutes. Callers that send no session (API clients) get a new autosave once the newest version is two
		 * minutes old. Best effort: it never fails or delays the save beyond its own queries.
		 */
		async saveSession(input: Owned & { data: TData; sessionId?: string | undefined }) {
			try {
				const [latest] = await db
					.select({ id: v.id, createdAt: v.createdAt })
					.from(v.table)
					.where(
						and(
							eq(v.document, input.documentId),
							...(input.sessionId ? [eq(v.kind, "auto"), eq(v.sessionId, input.sessionId)] : []),
						),
					)
					.orderBy(desc(v.createdAt))
					.limit(1);

				if (latest && Date.now() - (latest.createdAt as Date).getTime() < SESSION_REFRESH_MS) return;

				if (latest && input.sessionId) {
					await db
						.update(v.table)
						.set({ data: config.toStored(input.data), createdAt: new Date() } as never)
						.where(eq(v.id, latest.id));
					return;
				}

				await write(db, { ...input, kind: "auto" as TKind });
			} catch (error) {
				console.warn(`Failed to save the ${config.label}'s session version:`, error);
			}
		},

		async list(input: Owned) {
			const [owner] = await db
				.select({ id: config.owner.id })
				.from(config.owner.table)
				.where(and(eq(config.owner.id, input.documentId), eq(config.owner.userId, input.userId)));
			if (!owner) throw new ORPCError("NOT_FOUND");

			const recent = db
				.select({ id: v.id })
				.from(v.table)
				.where(
					and(eq(v.document, input.documentId), eq(v.userId, input.userId), inArray(v.kind, [...config.expiringKinds])),
				)
				.orderBy(desc(v.createdAt))
				.limit(LIST_LIMIT);
			const versions = await db
				.select(summary)
				.from(v.table)
				.where(
					and(
						eq(v.document, input.documentId),
						eq(v.userId, input.userId),
						or(notInArray(v.kind, [...config.expiringKinds]), inArray(v.id, recent)),
					),
				)
				.orderBy(desc(v.createdAt));
			return versions as VersionSummary<TKind>[];
		},

		async get(input: Owned & { versionId: string }) {
			const [version] = await db
				.select({ ...summary, data: v.data })
				.from(v.table)
				.where(ownedVersion(input));
			if (!version) throw new ORPCError("NOT_FOUND");
			return version as VersionSummary<TKind> & { data: unknown };
		},

		/** Named versions are the user's own; only they can be renamed or deleted. */
		async rename(input: Owned & { versionId: string; name: string }) {
			const [version] = await db
				.update(v.table)
				.set({ name: input.name } as never)
				.where(and(ownedVersion(input), eq(v.kind, "named")))
				.returning(summary);
			if (!version) throw new ORPCError("NOT_FOUND");
			return version as VersionSummary<TKind>;
		},

		async remove(input: Owned & { versionId: string }) {
			const [version] = await db
				.delete(v.table)
				.where(and(ownedVersion(input), eq(v.kind, "named")))
				.returning({ id: v.id });
			if (!version) throw new ORPCError("NOT_FOUND");
		},
	};
}
