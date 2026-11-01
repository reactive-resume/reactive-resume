import type { DbOrTx } from "@reactive-resume/db/client";
import type { CareerSource } from "@reactive-resume/schema/career";
import type z from "zod";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ORPCError } from "@orpc/client";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import {
	careerProfileDataSchema,
	careerWorkspaceSchema,
	EMPTY_WORKSPACE,
	type CareerProfileData,
	type CareerWorkspace,
	type careerFactInputSchema,
	type careerOfferInputSchema,
	type careerStoryInputSchema,
	offerTermsSchema,
	type OfferTerms,
	type SavedItemData,
} from "@reactive-resume/schema/career";
import { countryForTimeZone } from "@reactive-resume/utils/region";
import { generateId } from "@reactive-resume/utils/string";
import { requestRunCancellation } from "../agent/cancellation";
import { aiProvidersService } from "../ai-providers/service";
import { findTrackedPosting } from "../applications/duplicates";
import { syncFollowUp } from "../applications/follow-up";
import { applicationTransitionValues, ensureApplicationPipeline, savedStageOf } from "../applications/lanes";
import { applicationService, assertApplicationVersion, recordSentResume } from "../applications/service";
import { assertSharedDocument, lockUser } from "../documents/ownership";
import { matchPosting } from "./matching";
import { noticeText } from "./notices";

type Owned = { userId: string; applicationId?: string | null | undefined };
type FactInput = z.infer<typeof careerFactInputSchema>;
type StoryInput = z.infer<typeof careerStoryInputSchema>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const visible = (column: typeof tables.careerFact.applicationId, applicationId?: string | null) =>
	applicationId ? or(isNull(column), eq(column, applicationId)) : isNull(column);
const ownedFact = (id: string, userId: string) =>
	and(eq(tables.careerFact.id, id), eq(tables.careerFact.userId, userId));

/**
 * A profile save is a whole-object PUT, and older clients drop fields they don't know. A save that
 * leaves searchRegions out keeps the stored value; an explicit [] or null replaces it.
 */
export function mergeCareerProfile(stored: CareerProfileData, input: CareerProfileData): CareerProfileData {
	return input.searchRegions === undefined ? { ...input, searchRegions: stored.searchRegions } : input;
}

export async function requireCareerApplication(input: Owned & { interviewId?: string | null | undefined }) {
	if (!input.applicationId) {
		if (input.interviewId) throw new ORPCError("BAD_REQUEST", { message: "Choose an application for this interview." });
		return null;
	}
	const application = await applicationService.getById({ id: input.applicationId, userId: input.userId });
	if (
		input.interviewId &&
		!application.activity.some((entry) => entry.type === "interview" && entry.id === input.interviewId)
	)
		throw new ORPCError("NOT_FOUND", {
			message: "This interview is no longer part of this application. Choose another interview.",
		});
	return application;
}

/** The text a source holds, and its stored id (a chat message is found by its row or its message id). */
async function sourceText(
	userId: string,
	source: CareerSource,
	applicationId: string | null,
): Promise<{ text: string; id: string }> {
	// Typed or confirmed by the user in the app.
	if (source.kind === "manual" || source.kind === "debrief") return { text: source.quote, id: source.id };
	if (source.kind === "user-message") {
		// The coach quotes the saved row; "Remember" on a message in the chat knows only the message's own id.
		const rows = await db
			.select({
				id: tables.agentMessage.id,
				message: tables.agentMessage.uiMessage,
				applicationId: tables.agentThread.applicationId,
			})
			.from(tables.agentMessage)
			.innerJoin(tables.agentThread, eq(tables.agentMessage.threadId, tables.agentThread.id))
			.where(
				and(
					or(eq(tables.agentMessage.id, source.id), sql`${tables.agentMessage.uiMessage}->>'id' = ${source.id}`),
					eq(tables.agentMessage.userId, userId),
					eq(tables.agentMessage.role, "user"),
					isNull(tables.agentThread.deletedAt),
				),
			)
			.limit(2);
		const [row] = rows;
		// An application's conversation backs only facts private to that application; an ambiguous id backs nothing.
		if (!row || rows.length > 1 || (row.applicationId && row.applicationId !== applicationId))
			throw new ORPCError("NOT_FOUND");
		const parts = row.message.parts;
		const text = Array.isArray(parts)
			? parts
					.flatMap((part: { type?: string; text?: string }) => (part.type === "text" ? [part.text ?? ""] : []))
					.join("\n")
			: "";
		return { text, id: row.id };
	}
	if (source.kind === "resume-version") {
		const [row] = await db
			.select()
			.from(tables.resumeVersion)
			.where(and(eq(tables.resumeVersion.id, source.id), eq(tables.resumeVersion.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: buildMarkdown(row.data), id: source.id };
	}
	if (source.kind === "letter-version") {
		const [row] = await db
			.select()
			.from(tables.coverLetterVersion)
			.where(and(eq(tables.coverLetterVersion.id, source.id), eq(tables.coverLetterVersion.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: row.data.content, id: source.id };
	}
	if (source.kind === "resume") {
		const [row] = await db
			.select({ data: tables.resume.data })
			.from(tables.resume)
			.where(and(eq(tables.resume.id, source.id), eq(tables.resume.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: buildMarkdown(row.data), id: source.id };
	}
	if (source.kind === "letter") {
		const [row] = await db
			.select({ content: tables.coverLetter.content })
			.from(tables.coverLetter)
			.where(and(eq(tables.coverLetter.id, source.id), eq(tables.coverLetter.userId, userId)));
		if (!row) throw new ORPCError("NOT_FOUND");
		return { text: row.content, id: source.id };
	}
	throw new ORPCError("BAD_REQUEST", {
		message: "Use a user statement or an owned document as evidence for a career fact.",
	});
}

/** How many stories each fact backs and how many saved items used it. */
const factUsage = {
	stories: sql<number>`(select count(*)::int from ${tables.careerStory} s where s.user_id = ${tables.careerFact.userId} and s.data->'factIds' ? ${tables.careerFact.id})`,
	savedItems: sql<number>`(select count(*)::int from ${tables.careerArtifact} a where a.user_id = ${tables.careerFact.userId} and a.evidence->'factIds' ? ${tables.careerFact.id})`,
};

async function requireFacts(input: Owned, ids: string[], reader: DbOrTx = db) {
	if (!ids.length) return [];
	const rows = await reader
		.select()
		.from(tables.careerFact)
		.where(
			and(
				eq(tables.careerFact.userId, input.userId),
				inArray(tables.careerFact.id, ids),
				eq(tables.careerFact.status, "active"),
				visible(tables.careerFact.applicationId, input.applicationId),
			),
		);
	if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size)
		throw new ORPCError("BAD_REQUEST", {
			message: "Some supporting facts aren't available here. Remove them and try again.",
		});
	return rows;
}

/**
 * The account's own facts among those workspace answers cite. Answers are a draft the client saves, so a saved item
 * records only facts that belong to the account (a deleted or foreign id is dropped).
 */
async function ownedFactIds(reader: DbOrTx, userId: string, answers: { factIds: string[] }[]) {
	const ids = [...new Set(answers.flatMap((answer) => answer.factIds))];
	if (!ids.length) return [];
	const rows = await reader
		.select({ id: tables.careerFact.id })
		.from(tables.careerFact)
		.where(and(eq(tables.careerFact.userId, userId), inArray(tables.careerFact.id, ids)));
	const owned = new Set(rows.map((row) => row.id));
	return ids.filter((id) => owned.has(id));
}

export const modelFact = (fact: typeof tables.careerFact.$inferSelect) => ({
	id: fact.id,
	text: fact.text,
	category: fact.category,
	applicationId: fact.applicationId,
	source: { kind: fact.source.kind, id: fact.source.id },
	updatedAt: fact.updatedAt,
});

async function pipelineRevision(userId: string, reader: DbOrTx) {
	const [pipeline] = await reader
		.select({ revision: tables.applicationPipeline.revision })
		.from(tables.applicationPipeline)
		.where(eq(tables.applicationPipeline.userId, userId));
	return pipeline?.revision ?? 0;
}

async function memoryVersion(userId: string, reader: DbOrTx = db) {
	// New facts can be remembered within a turn; corrections/exclusions invalidate every in-flight draft.
	const revisions = await reader
		.select({
			id: tables.careerFact.id,
			text: tables.careerFact.text,
			status: tables.careerFact.status,
			revisions: tables.careerFact.revisions,
		})
		.from(tables.careerFact)
		.where(
			and(
				eq(tables.careerFact.userId, userId),
				or(sql`${tables.careerFact.status} <> 'active'`, sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`),
			),
		)
		.orderBy(tables.careerFact.id);
	return hash(JSON.stringify(revisions));
}

/** Structured generation is read-only: any change to its Knowledge/preferences invalidates the result. */
function knowledgeSignature(
	profile: z.infer<typeof careerProfileDataSchema>,
	facts: Array<typeof tables.careerFact.$inferSelect>,
	stories: Array<typeof tables.careerStory.$inferSelect>,
	timezone: string,
) {
	return hash(
		JSON.stringify([
			profile,
			timezone,
			facts
				.map(({ id, applicationId, text, category, status, revisions, source, updatedAt }) => ({
					id,
					applicationId,
					text,
					category,
					status,
					revisions,
					source,
					updatedAt,
				}))
				.sort((a, b) => a.id.localeCompare(b.id)),
			stories
				.map(({ id, applicationId, data, updatedAt }) => ({ id, applicationId, data, updatedAt }))
				.sort((a, b) => a.id.localeCompare(b.id)),
		]),
	);
}

async function knowledgeVersion(input: Owned, reader: DbOrTx = db) {
	const [[profile], facts, stories, [owner]] = await Promise.all([
		reader.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, input.userId)),
		reader
			.select()
			.from(tables.careerFact)
			.where(
				and(
					eq(tables.careerFact.userId, input.userId),
					visible(tables.careerFact.applicationId, input.applicationId),
					sql`${tables.careerFact.status} <> 'forgotten'`,
				),
			),
		reader
			.select()
			.from(tables.careerStory)
			.where(
				and(
					eq(tables.careerStory.userId, input.userId),
					input.applicationId
						? or(isNull(tables.careerStory.applicationId), eq(tables.careerStory.applicationId, input.applicationId))
						: isNull(tables.careerStory.applicationId),
				),
			),
		reader.select({ timezone: tables.user.timezone }).from(tables.user).where(eq(tables.user.id, input.userId)),
	]);
	return knowledgeSignature(
		careerProfileDataSchema.parse(profile?.data ?? {}),
		facts,
		stories,
		owner?.timezone ?? "UTC",
	);
}

/**
 * A fact changed: stop in-flight coach replies that read the old text. A forgotten fact is also unlinked from
 * stories and saved items, so nothing keeps pointing at it.
 */
async function invalidateMemory(userId: string, id: string, tx: DbOrTx, forgotten = false) {
	if (forgotten) {
		const unlink = (column: typeof tables.careerStory.data | typeof tables.careerArtifact.evidence) =>
			sql`jsonb_set(${column}, '{factIds}', coalesce((select jsonb_agg(f) from jsonb_array_elements(${column}->'factIds') f where f <> to_jsonb(${id}::text)), '[]'::jsonb))`;
		await tx
			.update(tables.careerStory)
			.set({ data: sql`jsonb_set(${tables.careerStory.data}, '{factIds}', '[]'::jsonb)` })
			.where(and(eq(tables.careerStory.userId, userId), sql`${tables.careerStory.data}->'factIds' ? ${id}`));
		await tx
			.update(tables.careerArtifact)
			.set({ evidence: unlink(tables.careerArtifact.evidence) })
			.where(and(eq(tables.careerArtifact.userId, userId), sql`${tables.careerArtifact.evidence}->'factIds' ? ${id}`));
	}
	const threads = await tx
		.select({ runId: tables.agentThread.activeRunId })
		.from(tables.agentThread)
		.where(
			and(
				eq(tables.agentThread.userId, userId),
				// Document conversations too: one may be reading Knowledge right now.
				sql`${tables.agentThread.activeRunId} is not null`,
			),
		);
	await Promise.all(
		threads.flatMap((thread) => (thread.runId ? [requestRunCancellation(thread.runId, "MEMORY_CHANGED")] : [])),
	);
}

export function hasFitEvidence(context: {
	facts: readonly unknown[];
	stories: readonly unknown[];
	resume: { text: string } | null;
}) {
	return context.facts.length > 0 || context.stories.length > 0 || !!context.resume?.text.trim();
}

const QUOTE_NOT_IN_SOURCE = "The source does not contain that quotation.";

/** The application fields applying an employer's message owns, as stored on the reply for Undo. */
const appliedFields = (row: typeof tables.application.$inferSelect) => ({
	status: row.status,
	laneId: row.laneId,
	closedReason: row.closedReason,
	followUpAt: row.followUpAt?.toISOString() ?? null,
	followUpNote: row.followUpNote,
	followUpDateOnly: row.followUpDateOnly,
});

export const careerService = {
	memoryVersion,
	/**
	 * The source as it is stored when its text contains the quotation, else null. Ask-first proposals and saves check
	 * the same text, so a proposal never quotes words its source doesn't hold.
	 */
	quotedSource: async (userId: string, source: CareerSource, applicationId: string | null) => {
		const { text, id } = await sourceText(userId, source, applicationId);
		return source.quote.trim() && text.includes(source.quote) ? { ...source, id } : null;
	},
	memoryCutoff: async (userId: string) => {
		const [row] = await db
			.select({ at: tables.careerFact.updatedAt })
			.from(tables.careerFact)
			.where(
				and(
					eq(tables.careerFact.userId, userId),
					or(sql`${tables.careerFact.status} <> 'active'`, sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`),
				),
			)
			.orderBy(desc(tables.careerFact.updatedAt))
			.limit(1);
		return row?.at ?? null;
	},
	profile: async (userId: string) => {
		const [row] = await db.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
		return careerProfileDataSchema.parse(row?.data ?? {});
	},
	/** Only untouched UTC accounts adopt a device country. Share the save lock so explicit choices always win. */
	initializeSearchRegions: (userId: string, deviceTimeZone: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.select({ data: tables.careerProfile.data, timezone: tables.user.timezone })
				.from(tables.user)
				.leftJoin(tables.careerProfile, eq(tables.careerProfile.userId, tables.user.id))
				.where(eq(tables.user.id, userId));
			const data = careerProfileDataSchema.parse(row?.data ?? {});
			const country = countryForTimeZone(deviceTimeZone);
			if (row?.timezone !== "UTC" || data.searchRegions !== undefined || !country) return data;
			data.searchRegions = [country];
			await tx
				.insert(tables.careerProfile)
				.values({ userId, data })
				.onConflictDoUpdate({ target: tables.careerProfile.userId, set: { data, updatedAt: new Date() } });
			return data;
		}),
	saveProfile: (userId: string, input: CareerProfileData) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.select({ data: tables.careerProfile.data })
				.from(tables.careerProfile)
				.where(eq(tables.careerProfile.userId, userId));
			const data = mergeCareerProfile(careerProfileDataSchema.parse(row?.data ?? {}), input);
			await tx
				.insert(tables.careerProfile)
				.values({ userId, data })
				.onConflictDoUpdate({ target: tables.careerProfile.userId, set: { data, updatedAt: new Date() } });
			return data;
		}),
	/** Facts the coach can use for an application (or shared ones). `all` lists every scope, for Knowledge. */
	facts: async (input: Owned & { query?: string | undefined; all?: boolean | undefined }) => {
		await requireCareerApplication(input);
		const rows = await db
			.select({ fact: tables.careerFact, company: tables.application.company, ...factUsage })
			.from(tables.careerFact)
			.leftJoin(tables.application, eq(tables.application.id, tables.careerFact.applicationId))
			.where(
				and(
					eq(tables.careerFact.userId, input.userId),
					input.all ? undefined : visible(tables.careerFact.applicationId, input.applicationId),
					sql`${tables.careerFact.status} <> 'forgotten'`,
					input.query?.trim()
						? sql`to_tsvector('simple', ${tables.careerFact.text}) @@ plainto_tsquery('simple', ${input.query.trim()})`
						: undefined,
				),
			)
			.orderBy(desc(tables.careerFact.createdAt), desc(tables.careerFact.id));
		return rows.map(({ fact, company, stories, savedItems }) => ({
			...fact,
			company,
			usedBy: { stories, savedItems },
		}));
	},
	saveFact: async (userId: string, input: FactInput, automatic = false) => {
		await requireCareerApplication({ userId, applicationId: input.applicationId });
		if (automatic && (input.source.kind !== "user-message" || input.text !== input.source.quote))
			throw new ORPCError("BAD_REQUEST", { message: "Automatic memory must quote the user's own words exactly." });
		if (automatic && (await careerService.profile(userId)).memoryMode !== "auto") return null;
		const source = await careerService.quotedSource(userId, input.source, input.applicationId);
		if (!source) throw new ORPCError("BAD_REQUEST", { message: QUOTE_NOT_IN_SOURCE });
		// One key per stored source, so a message remembered from the chat and by the coach is the same fact.
		const fact = { ...input, source };
		const sourceKey = hash(`${source.kind}:${source.id}:${source.quote.trim().toLocaleLowerCase()}`);
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (automatic) {
				const [profile] = await tx.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
				if (careerProfileDataSchema.parse(profile?.data ?? {}).memoryMode !== "auto") return null;
			}
			const [suppressed] = await tx
				.select({ id: tables.careerFact.id })
				.from(tables.careerFact)
				.where(
					and(
						eq(tables.careerFact.userId, userId),
						sql`${tables.careerFact.source}->>'kind' = ${source.kind}`,
						sql`${tables.careerFact.source}->>'id' = ${source.id}`,
						or(
							eq(tables.careerFact.status, "forgotten"),
							eq(tables.careerFact.status, "excluded"),
							sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`,
						),
					),
				)
				.limit(1);
			if (suppressed) return null;
			// A forgotten source key remains a content-free tombstone; retries cannot recreate the fact.
			const [row] = await tx
				.insert(tables.careerFact)
				.values({ userId, ...fact, sourceKey })
				.onConflictDoNothing()
				.returning();
			return row ?? null;
		});
	},
	updateFact: async (
		userId: string,
		input: {
			id: string;
			text?: string | undefined;
			status?: "active" | "excluded" | undefined;
			share?: boolean | undefined;
		},
	) => {
		const updated = await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx.select().from(tables.careerFact).where(ownedFact(input.id, userId)).for("update");
			if (!row || row.status === "forgotten") throw new ORPCError("NOT_FOUND");
			const [updated] = await tx
				.update(tables.careerFact)
				.set({
					...(input.text !== undefined
						? {
								text: input.text,
								revisions: [...row.revisions, { text: row.text, at: new Date().toISOString() }].slice(-50),
							}
						: {}),
					...(input.status ? { status: input.status } : {}),
					...(input.share ? { applicationId: null } : {}),
				})
				.where(ownedFact(input.id, userId))
				.returning();
			if (input.text !== undefined || input.status !== undefined) await invalidateMemory(userId, input.id, tx);
			if (!updated) throw new ORPCError("NOT_FOUND");
			return updated;
		});
		return updated;
	},
	forgetFact: async (userId: string, id: string) => {
		await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.update(tables.careerFact)
				.set({
					text: "",
					status: "forgotten",
					source: sql`jsonb_set(${tables.careerFact.source}, '{quote}', '""'::jsonb)`,
					revisions: [],
				})
				.where(ownedFact(id, userId))
				.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			await invalidateMemory(userId, id, tx, true);
		});
	},
	stories: async (input: Owned) => {
		await requireCareerApplication(input);
		return db
			.select()
			.from(tables.careerStory)
			.where(
				and(
					eq(tables.careerStory.userId, input.userId),
					input.applicationId
						? or(isNull(tables.careerStory.applicationId), eq(tables.careerStory.applicationId, input.applicationId))
						: isNull(tables.careerStory.applicationId),
				),
			)
			.orderBy(desc(tables.careerStory.updatedAt));
	},
	saveStory: async (userId: string, input: StoryInput, id?: string, expectedMemoryVersion?: string) => {
		await requireCareerApplication({ userId, applicationId: input.applicationId });
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			if (expectedMemoryVersion && expectedMemoryVersion !== (await memoryVersion(userId, tx)))
				throw new ORPCError("CONFLICT", { message: "Career memory changed. Start a fresh reply." });
			await requireFacts({ userId, applicationId: input.applicationId }, input.factIds, tx);
			const values = { applicationId: input.applicationId, data: input };
			const [row] = id
				? await tx
						.update(tables.careerStory)
						.set(values)
						.where(and(eq(tables.careerStory.id, id), eq(tables.careerStory.userId, userId)))
						.returning()
				: await tx
						.insert(tables.careerStory)
						.values({ userId, ...values })
						.returning();
			if (!row) throw new ORPCError("NOT_FOUND");
			return row;
		});
	},
	deleteStory: async (userId: string, id: string) => {
		await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			await tx
				.delete(tables.careerStory)
				.where(and(eq(tables.careerStory.id, id), eq(tables.careerStory.userId, userId)));
		});
	},
	context: async (input: Owned & { interviewId?: string | null | undefined }) => {
		const memoryRevision = await memoryVersion(input.userId);
		const storedApplication = await requireCareerApplication(input);
		const pipeline = storedApplication
			? await db.transaction(async (tx) => {
					await lockUser(tx, input.userId);
					return ensureApplicationPipeline(tx, input.userId);
				})
			: null;
		const lane = pipeline?.lanes.find(
			(lane) =>
				lane.id === storedApplication?.laneId ||
				(!storedApplication?.laneId && lane.systemKey === storedApplication?.status),
		);
		const application = storedApplication ? { ...storedApplication, laneLabel: lane?.label ?? null } : null;
		const [preferences, facts, stories, [owner]] = await Promise.all([
			careerService.profile(input.userId),
			careerService.facts(input),
			careerService.stories(input),
			db.select({ timezone: tables.user.timezone }).from(tables.user).where(eq(tables.user.id, input.userId)),
		]);
		// The coach reads times in the user's timezone (Settings → Preferences) with the rest of their preferences.
		const profile = { ...preferences, timezone: owner?.timezone ?? "UTC" };
		const knowledgeRevision = knowledgeSignature(preferences, facts, stories, profile.timezone);
		let resume: { text: string; version: string; submitted: boolean; source: { kind: string; id: string } } | null =
			null;
		let letter: { text: string; version: string; submitted: boolean; source: { kind: string; id: string } } | null =
			null;
		if (application?.sentResumeVersionId) {
			const [row] = await db
				.select()
				.from(tables.resumeVersion)
				.where(
					and(
						eq(tables.resumeVersion.id, application.sentResumeVersionId),
						eq(tables.resumeVersion.userId, input.userId),
					),
				);
			if (row)
				resume = {
					text: buildMarkdown(row.data),
					version: row.id,
					submitted: true,
					source: { kind: "resume-version", id: row.id },
				};
		} else if (application?.resumeId) {
			const [row] = await db
				.select()
				.from(tables.resume)
				.where(and(eq(tables.resume.id, application.resumeId), eq(tables.resume.userId, input.userId)));
			if (row)
				resume = {
					text: buildMarkdown(row.data),
					version: row.updatedAt.toISOString(),
					submitted: false,
					source: { kind: "resume", id: row.id },
				};
		}
		if (application?.sentCoverLetterVersionId) {
			const [row] = await db
				.select()
				.from(tables.coverLetterVersion)
				.where(
					and(
						eq(tables.coverLetterVersion.id, application.sentCoverLetterVersionId),
						eq(tables.coverLetterVersion.userId, input.userId),
					),
				);
			if (row)
				letter = {
					text: row.data.content,
					version: row.id,
					submitted: true,
					source: { kind: "letter-version", id: row.id },
				};
		} else if (application?.coverLetterId) {
			const [row] = await db
				.select()
				.from(tables.coverLetter)
				.where(and(eq(tables.coverLetter.id, application.coverLetterId), eq(tables.coverLetter.userId, input.userId)));
			if (row)
				letter = {
					text: row.content,
					version: row.updatedAt.toISOString(),
					submitted: false,
					source: { kind: "letter", id: row.id },
				};
		}
		const blockedSources = await db
			.select({ source: tables.careerFact.source })
			.from(tables.careerFact)
			.where(
				and(
					eq(tables.careerFact.userId, input.userId),
					or(sql`${tables.careerFact.status} <> 'active'`, sql`jsonb_array_length(${tables.careerFact.revisions}) > 0`),
				),
			);
		if (
			blockedSources.some(
				({ source }) =>
					(source.kind === "resume" && source.id === application?.resumeId) ||
					(source.kind === "resume-version" && source.id === application?.sentResumeVersionId),
			)
		)
			resume = null;
		if (
			blockedSources.some(
				({ source }) =>
					(source.kind === "letter" && source.id === application?.coverLetterId) ||
					(source.kind === "letter-version" && source.id === application?.sentCoverLetterVersionId),
			)
		)
			letter = null;
		const interview = input.interviewId
			? (application?.activity.find((entry) => entry.type === "interview" && entry.id === input.interviewId) ?? null)
			: null;
		const activeFacts = facts.filter((fact) => fact.status === "active").map(modelFact);
		const usableStories = stories.filter(
			(story) =>
				story.data.factIds.length > 0 &&
				story.data.factIds.every((id) =>
					facts.some(
						(fact) =>
							fact.id === id &&
							fact.status === "active" &&
							(fact.revisions.length === 0 || story.updatedAt >= fact.updatedAt),
					),
				),
		);
		if (memoryRevision !== (await memoryVersion(input.userId)) || knowledgeRevision !== (await knowledgeVersion(input)))
			throw new ORPCError("CONFLICT", { message: "Career memory changed while preparing context. Try again." });
		const version = hash(
			JSON.stringify([
				memoryRevision,
				application?.updatedAt,
				pipeline?.revision,
				profile,
				facts.map((fact) => [fact.id, fact.updatedAt]),
				stories.map((story) => [story.id, story.updatedAt]),
				resume?.version,
				letter?.version,
			]),
		);
		return {
			application,
			interview,
			profile,
			facts: activeFacts,
			stories: usableStories,
			resume,
			letter,
			version,
			memoryVersion: memoryRevision,
			pipelineRevision: pipeline?.revision ?? null,
			knowledgeVersion: knowledgeRevision,
		};
	},
	/** Saved items for one application (or across all of them for one kind), newest first. */
	savedItems: async (input: Owned & { kind?: SavedItemData["kind"] | undefined }) => {
		const context = input.applicationId ? await careerService.context(input) : null;
		const rows = await db
			.select({
				item: tables.careerArtifact,
				company: tables.application.company,
				role: tables.application.role,
				activity: tables.application.activity,
				status: tables.application.status,
				closedReason: tables.application.closedReason,
			})
			.from(tables.careerArtifact)
			.leftJoin(tables.application, eq(tables.application.id, tables.careerArtifact.applicationId))
			.where(
				and(
					eq(tables.careerArtifact.userId, input.userId),
					input.applicationId ? eq(tables.careerArtifact.applicationId, input.applicationId) : undefined,
					input.kind ? sql`${tables.careerArtifact.data}->>'kind' = ${input.kind}` : undefined,
				),
			)
			.orderBy(desc(tables.careerArtifact.createdAt), desc(tables.careerArtifact.id));
		return rows.map(({ item, company, role, activity, status, closedReason }) => {
			// Restore schema key order before hashing: JSONB reorders object keys on disk.
			const parsed =
				item.data.kind === "answers" ? careerWorkspaceSchema.shape.answers.safeParse(item.data.answers) : null;
			const answers = parsed?.success ? parsed.data : null;
			return {
				...item,
				// Submission writers hash the answers; generated drafts use the context version.
				submission:
					answers !== null &&
					(item.inputVersion === hash(JSON.stringify(answers)) ||
						(activity ?? []).some(
							(entry) =>
								entry.type === "stage" &&
								entry.stage === "applied" &&
								entry.canonicalTransition !== false &&
								item.inputVersion === hash(JSON.stringify([item.applicationId, entry.at, answers])),
						)),
				application: company === null ? null : { company, role: role ?? "", status, closedReason },
				// Knowledge, the posting or documents changed since it was written.
				outdated: item.data.kind !== "answers" && context !== null && item.inputVersion !== context.version,
			};
		});
	},
	createOffer: async (userId: string, { applicationId, ...terms }: z.infer<typeof careerOfferInputSchema>) => {
		const context = await careerService.context({ userId, applicationId });
		if (!context.application) throw new ORPCError("NOT_FOUND");
		return careerService.saveSavedItem({
			userId,
			applicationId,
			interviewId: null,
			title: `${context.application.company} · ${terms.version === "verbal" ? "Verbal offer" : "Written offer"}`,
			data: { kind: "offer", ...terms, origin: "manual" },
			evidence: { factIds: [], storyIds: [] },
			inputVersion: context.version,
		});
	},
	/**
	 * Corrects a saved offer's terms. `expected` is the copy the user edited: a change made elsewhere since then is a
	 * conflict, never overwritten. Where the terms came from is kept.
	 */
	updateOffer: (userId: string, id: string, terms: OfferTerms, expected: OfferTerms) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [row] = await tx
				.select()
				.from(tables.careerArtifact)
				.where(and(eq(tables.careerArtifact.id, id), eq(tables.careerArtifact.userId, userId)))
				.for("update");
			if (!row || row.data.kind !== "offer") throw new ORPCError("NOT_FOUND");
			const { kind: _kind, origin, editedAt: _editedAt, ...current } = row.data;
			if (!isDeepStrictEqual(offerTermsSchema.parse(current), offerTermsSchema.parse(expected)))
				throw new ORPCError("CONFLICT", {
					message: "This offer changed elsewhere. Review the latest terms before saving again.",
				});
			const data: SavedItemData = {
				kind: "offer",
				...offerTermsSchema.parse(terms),
				...(origin ? { origin } : {}),
				editedAt: new Date().toISOString(),
			};
			const company = row.title.split(" · ")[0] ?? "";
			const [updated] = await tx
				.update(tables.careerArtifact)
				.set({ data, title: `${company} · ${terms.version === "verbal" ? "Verbal offer" : "Written offer"}` })
				.where(eq(tables.careerArtifact.id, id))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			return updated;
		}),
	saveSavedItem: (input: {
		userId: string;
		applicationId: string;
		interviewId: string | null;
		title: string;
		data: SavedItemData;
		evidence: { factIds: string[]; storyIds: string[] };
		inputVersion: string;
		jobId?: string;
		jobLease?: string;
		expectedMemoryVersion?: string;
		expectedKnowledgeVersion?: string;
		expectedPipelineRevision?: number | null;
	}) =>
		db.transaction(async (tx) => {
			const { expectedMemoryVersion, expectedKnowledgeVersion, expectedPipelineRevision, jobLease, ...values } = input;
			// User → application → schedule → job. No key update permits unrelated FK inserts for this user.
			await lockUser(tx, input.userId);
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, input.applicationId), eq(tables.application.userId, input.userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			if (input.jobId) {
				if (application.status === "closed") return null;
				// Match the schedule editor's lock order. Pausing and publishing cannot pass each other.
				const [job] = await tx
					.select()
					.from(tables.careerJob)
					.where(and(eq(tables.careerJob.id, input.jobId), eq(tables.careerJob.userId, input.userId)));
				if (!job) return null;
				const [schedule] = await tx
					.select()
					.from(tables.careerSchedule)
					.where(eq(tables.careerSchedule.id, job.scheduleId))
					.for("update");
				const [current] = await tx.select().from(tables.careerJob).where(eq(tables.careerJob.id, job.id)).for("update");
				if (
					!schedule?.enabled ||
					!current ||
					current.status !== "running" ||
					current.lease !== jobLease ||
					!current.leaseUntil ||
					current.leaseUntil <= new Date()
				)
					return null;
			}
			if (
				(expectedMemoryVersion !== undefined && expectedMemoryVersion !== (await memoryVersion(input.userId, tx))) ||
				(expectedKnowledgeVersion !== undefined && expectedKnowledgeVersion !== (await knowledgeVersion(input, tx))) ||
				(expectedPipelineRevision !== undefined &&
					expectedPipelineRevision !== (await pipelineRevision(input.userId, tx)))
			)
				throw new ORPCError("CONFLICT", {
					message: "Career knowledge changed while generating this result. Generate it again.",
				});
			const [row] = await tx
				.insert(tables.careerArtifact)
				.values({ ...values, jobId: input.jobId ?? null })
				.onConflictDoNothing()
				.returning();
			return row ?? null;
		}),
	assertMemoryVersion: (
		userId: string,
		expected: string,
		knowledge?: {
			applicationId?: string | null;
			version?: string;
			pipelineRevision?: number | null;
			application?: { id: string; updatedAt: Date };
			documents?: readonly { source: { kind: string; id: string }; version: string }[];
			job?: { id: string; lease: string; providerVersion: string };
			sources?: {
				facts: readonly { id: string; updatedAt: Date }[];
				stories: readonly { id: string; updatedAt: Date }[];
				profile: CareerProfileData & { timezone: string };
			};
		},
		selectedResume?: Pick<typeof tables.resume.$inferSelect, "id" | "data" | "updatedAt">,
		providerId?: string,
		reader?: DbOrTx,
	) => {
		const validate = async (tx: DbOrTx) => {
			if (selectedResume) {
				const [current] = await tx
					.select({ id: tables.resume.id, data: tables.resume.data, updatedAt: tables.resume.updatedAt })
					.from(tables.resume)
					.where(
						and(
							eq(tables.resume.id, selectedResume.id),
							eq(tables.resume.userId, userId),
							isNull(tables.resume.trashedAt),
						),
					)
					.for("share");
				if (!isDeepStrictEqual(current, selectedResume))
					throw new ORPCError("CONFLICT", {
						message: "Selected resume changed while preparing roles. Generate suggestions again.",
					});
			}
			if (
				expected !== (await memoryVersion(userId, tx)) ||
				(knowledge &&
					((knowledge.version !== undefined &&
						knowledge.version !== (await knowledgeVersion({ userId, applicationId: knowledge.applicationId }, tx))) ||
						(knowledge.pipelineRevision !== undefined &&
							knowledge.pipelineRevision !== (await pipelineRevision(userId, tx)))))
			)
				throw new ORPCError("CONFLICT", {
					message: "Career knowledge changed while generating this result. Generate it again.",
				});
			if (knowledge?.application) await assertApplicationVersion(tx, userId, knowledge.application);
			for (const document of knowledge?.documents ?? []) await assertSharedDocument(tx, userId, document);
			if (knowledge?.job) {
				const [job] = await tx
					.select({
						enabled: tables.careerSchedule.enabled,
						aiProviderId: tables.careerSchedule.aiProviderId,
						aiProviderVersion: tables.careerSchedule.aiProviderVersion,
						status: tables.careerJob.status,
						lease: tables.careerJob.lease,
						leaseUntil: tables.careerJob.leaseUntil,
					})
					.from(tables.careerJob)
					.innerJoin(tables.careerSchedule, eq(tables.careerJob.scheduleId, tables.careerSchedule.id))
					.where(and(eq(tables.careerJob.id, knowledge.job.id), eq(tables.careerJob.userId, userId)))
					.for("share");
				if (
					!job?.enabled ||
					!providerId ||
					job.aiProviderId !== providerId ||
					job.aiProviderVersion !== knowledge.job.providerVersion ||
					job.status !== "running" ||
					job.lease !== knowledge.job.lease ||
					!job.leaseUntil ||
					job.leaseUntil <= new Date()
				)
					throw new ORPCError("CONFLICT", { message: "Scheduled work was paused or canceled. Nothing was sent." });
			}
			if (knowledge?.sources) {
				const expectedSources = knowledge.sources;
				const [facts, stories, [profile], [owner]] = await Promise.all([
					tx
						.select({ id: tables.careerFact.id, updatedAt: tables.careerFact.updatedAt })
						.from(tables.careerFact)
						.where(
							and(
								eq(tables.careerFact.userId, userId),
								visible(tables.careerFact.applicationId, knowledge.applicationId),
								eq(tables.careerFact.status, "active"),
							),
						),
					tx
						.select({ id: tables.careerStory.id, updatedAt: tables.careerStory.updatedAt })
						.from(tables.careerStory)
						.where(
							and(
								eq(tables.careerStory.userId, userId),
								knowledge.applicationId
									? or(
											isNull(tables.careerStory.applicationId),
											eq(tables.careerStory.applicationId, knowledge.applicationId),
										)
									: isNull(tables.careerStory.applicationId),
							),
						),
					tx.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId)),
					tx.select({ timezone: tables.user.timezone }).from(tables.user).where(eq(tables.user.id, userId)),
				]);
				const changed = (before: readonly { id: string; updatedAt: Date }[], now: { id: string; updatedAt: Date }[]) =>
					before.some(
						(entry) => !now.some((row) => row.id === entry.id && row.updatedAt.getTime() === entry.updatedAt.getTime()),
					);
				if (
					changed(expectedSources.facts, facts) ||
					changed(expectedSources.stories, stories) ||
					!isDeepStrictEqual(
						{ ...careerProfileDataSchema.parse(profile?.data ?? {}), timezone: owner?.timezone ?? "UTC" },
						expectedSources.profile,
					)
				)
					throw new ORPCError("CONFLICT", { message: "Shared Knowledge changed. Start a new reply." });
			}
			if (providerId) await aiProvidersService.assertAvailable({ id: providerId, userId }, tx);
		};
		return reader
			? validate(reader)
			: db.transaction(async (tx) => {
					await lockUser(tx, userId);
					await validate(tx);
				});
	},
	deleteSavedItem: async (userId: string, id: string) => {
		await db
			.delete(tables.careerArtifact)
			.where(and(eq(tables.careerArtifact.id, id), eq(tables.careerArtifact.userId, userId)));
	},
	/**
	 * Applies the ticked changes of a read employer message. Reaching Applied goes through Mark as applied. Returns the
	 * application's stage only when this call writes it, so a repeat cannot acknowledge another device's move.
	 */
	applyReply: async (userId: string, id: string, selected: number[]) => {
		const [saved] = await db
			.select()
			.from(tables.careerArtifact)
			.where(and(eq(tables.careerArtifact.id, id), eq(tables.careerArtifact.userId, userId)));
		if (!saved?.applicationId || saved.data.kind !== "reply") throw new ORPCError("NOT_FOUND");
		const applicationId = saved.applicationId;
		// A repeat saved no stage; acknowledging the current row could adopt another device's later move.
		if (saved.data.applied) return { stages: [] };
		const context = await careerService.context({ userId, applicationId });
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), eq(tables.application.userId, userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			const [item] = await tx
				.select()
				.from(tables.careerArtifact)
				.where(and(eq(tables.careerArtifact.id, id), eq(tables.careerArtifact.userId, userId)))
				.for("update");
			if (!item?.applicationId || item.data.kind !== "reply") throw new ORPCError("NOT_FOUND");
			const data = item.data;
			if (data.applied) return { stages: [] };

			if (
				selected.some((index) => !Number.isInteger(index) || index < 0 || index >= data.changes.length) ||
				new Set(selected).size !== selected.length
			)
				throw new ORPCError("BAD_REQUEST", { message: "Choose valid proposed changes." });
			if (
				selected.length &&
				(item.inputVersion !== context.version ||
					context.pipelineRevision !== (await pipelineRevision(userId, tx)) ||
					application.updatedAt.getTime() !== context.application?.updatedAt.getTime() ||
					context.memoryVersion !== (await memoryVersion(userId, tx)))
			)
				throw new ORPCError("CONFLICT", {
					message:
						"This application or its knowledge changed since the message was read. Read the message again before applying changes.",
				});
			const changes = data.changes.filter((_, index) => selected.includes(index));
			const now = new Date();
			let offerId: string | null = null;
			let status = application.status;
			let followUpAt = application.followUpAt;
			let followUpNote = application.followUpNote;
			for (const change of changes) {
				if (change.type === "stage" && change.stage !== application.status) {
					if (application.status === "saved")
						throw new ORPCError("BAD_REQUEST", { message: "Mark the application as applied first." });
					status = change.stage;
				}
				// One change owns the next step, so its reminder and its words can't overwrite each other.
				// The old reminder belonged to the old next step, so a next step with nothing due clears it.
				if (change.type === "follow-up") {
					followUpAt = change.at ? new Date(change.at) : null;
					followUpNote = change.note || followUpNote;
				}
				if (change.type === "offer" && data.offer && !offerId) {
					const [offer] = await tx
						.insert(tables.careerArtifact)
						.values({
							userId,
							applicationId: application.id,
							interviewId: null,
							title: `${application.company} · ${data.offer.version === "verbal" ? "Verbal offer" : "Written offer"}`,
							data: { kind: "offer", ...data.offer, origin: "message" },
							evidence: { factIds: [], storyIds: [] },
							inputVersion: item.inputVersion,
						})
						.returning({ id: tables.careerArtifact.id });
					offerId = offer?.id ?? null;
				}
			}
			const { values, transition } = await applicationTransitionValues(tx, userId, { status }, application, now);
			const [updated] = await tx
				.update(tables.application)
				.set({
					...values,
					followUpAt,
					followUpNote,
					...(changes.some((change) => change.type === "follow-up") ? { followUpDateOnly: false } : {}),
				})
				.where(and(eq(tables.application.id, application.id), eq(tables.application.userId, userId)))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			if (transition.canonicalTransition) await recordSentResume(updated, tx);
			if (changes.some((change) => change.type === "follow-up")) await syncFollowUp(tx, updated);
			const undo = { before: appliedFields(application), after: appliedFields(updated), offerId };
			await tx
				.update(tables.careerArtifact)
				.set({ data: { ...data, applied: { at: now.toISOString(), changes: selected, undo } } })
				.where(eq(tables.careerArtifact.id, id));
			return { stages: updated && transition.changed ? [savedStageOf(updated)] : [] };
		});
	},
	/**
	 * Reverses Apply: the fields it set go back and the offer it saved is removed, only while nothing has changed them
	 * since. Versions recorded as sent stay; they are what the employer received. Undoing twice is a no-op.
	 */
	undoReply: (userId: string, id: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [item] = await tx
				.select()
				.from(tables.careerArtifact)
				.where(and(eq(tables.careerArtifact.id, id), eq(tables.careerArtifact.userId, userId)))
				.for("update");
			if (!item?.applicationId || item.data.kind !== "reply") throw new ORPCError("NOT_FOUND");
			const { applied, ...data } = item.data;
			if (!applied) return { stages: [] };
			if (!applied.undo)
				throw new ORPCError("BAD_REQUEST", {
					message: "This was applied before Undo was available. Change the application in Applications instead.",
				});
			const { before, after, offerId } = applied.undo;
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, item.applicationId), eq(tables.application.userId, userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			const changed = () =>
				new ORPCError("CONFLICT", {
					message: "This application changed after the update. Change it in Applications instead.",
				});
			if (!isDeepStrictEqual(appliedFields(application), after)) throw changed();
			if (offerId) {
				const [offer] = await tx
					.select({ data: tables.careerArtifact.data })
					.from(tables.careerArtifact)
					.where(and(eq(tables.careerArtifact.id, offerId), eq(tables.careerArtifact.userId, userId)))
					.for("update");
				// An offer corrected since is the user's own; a deleted one has nothing left to undo.
				if (offer?.data.kind === "offer" && offer.data.editedAt) throw changed();
				if (offer)
					await tx
						.delete(tables.careerArtifact)
						.where(and(eq(tables.careerArtifact.id, offerId), eq(tables.careerArtifact.userId, userId)));
			}
			const { values, transition } = await applicationTransitionValues(
				tx,
				userId,
				{ status: before.status, laneId: before.laneId ?? undefined, closedReason: before.closedReason },
				application,
			);
			// Moving back to Applied is not a new submission: the date sent and what was sent stay as recorded.
			const activity =
				values.activity && before.status === "applied"
					? values.activity.map((entry, index, all) =>
							index === all.length - 1 && entry.type === "stage" ? { ...entry, canonicalTransition: false } : entry,
						)
					: values.activity;
			const [updated] = await tx
				.update(tables.application)
				.set({
					...values,
					...(activity ? { activity } : {}),
					appliedAt: application.appliedAt,
					followUpAt: before.followUpAt ? new Date(before.followUpAt) : null,
					followUpNote: before.followUpNote,
					followUpDateOnly: before.followUpDateOnly,
				})
				.where(eq(tables.application.id, application.id))
				.returning();
			if (!updated) throw new ORPCError("NOT_FOUND");
			await syncFollowUp(tx, updated);
			await tx
				.update(tables.careerArtifact)
				.set({ data: { ...data, applied: null } })
				.where(eq(tables.careerArtifact.id, id));
			return { stages: transition.changed ? [savedStageOf(updated)] : [] };
		}),
	workspace: async (userId: string, applicationId: string) => {
		await requireCareerApplication({ userId, applicationId });
		const [row] = await db
			.select({ data: tables.careerWorkspace.data })
			.from(tables.careerWorkspace)
			.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
		return careerWorkspaceSchema.parse({ ...EMPTY_WORKSPACE, ...row?.data });
	},
	/** Each widget saves its whole key; keys it doesn't send keep their stored values. */
	saveWorkspace: async (
		userId: string,
		applicationId: string,
		patch: { [K in keyof CareerWorkspace]?: CareerWorkspace[K] | undefined },
		expected: { [K in keyof CareerWorkspace]?: CareerWorkspace[K] | undefined },
	) => {
		await requireCareerApplication({ userId, applicationId });
		// The application row is the lock, so two saves to different keys can't read the same old copy.
		return db.transaction(async (tx) => {
			const [application] = await tx
				.select({ id: tables.application.id })
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), eq(tables.application.userId, userId)))
				.for("update");
			const [row] = await tx
				.select({ data: tables.careerWorkspace.data })
				.from(tables.careerWorkspace)
				.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
			if (!application) throw new ORPCError("NOT_FOUND");
			const current = careerWorkspaceSchema.parse({ ...EMPTY_WORKSPACE, ...row?.data });
			for (const key of Object.keys(patch) as (keyof CareerWorkspace)[]) {
				if (patch[key] === undefined) continue;
				if (!Object.hasOwn(expected, key))
					throw new ORPCError("BAD_REQUEST", {
						message: "Include the previous value for every changed workspace field.",
					});
				if (!isDeepStrictEqual(current[key], expected[key]) && !isDeepStrictEqual(current[key], patch[key]))
					throw new ORPCError("CONFLICT", {
						message:
							"This workspace changed elsewhere. Your draft has not been saved. Review the latest version before trying again.",
					});
			}
			const data = careerWorkspaceSchema.parse({
				...current,
				...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
			});
			await tx
				.insert(tables.careerWorkspace)
				.values({ applicationId, userId, data })
				.onConflictDoUpdate({ target: tables.careerWorkspace.applicationId, set: { data, updatedAt: new Date() } });
			return data;
		});
	},
	/** The submitted answers, document versions and stage are one committed action. */
	submitApplication: async (
		userId: string,
		applicationId: string,
		answers: CareerWorkspace["answers"],
		expectedAnswers: CareerWorkspace["answers"],
		expectedDocuments?: { resumeId: string | null; coverLetterId: string | null },
	) => {
		const parsed = careerWorkspaceSchema.shape.answers.parse(answers);
		return await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), eq(tables.application.userId, userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			if (
				expectedDocuments &&
				(expectedDocuments.resumeId !== application.resumeId ||
					expectedDocuments.coverLetterId !== application.coverLetterId)
			)
				throw new ORPCError("CONFLICT", {
					message: "Selected documents changed elsewhere. Review them before marking as applied.",
				});
			const [workspace] = await tx
				.select()
				.from(tables.careerWorkspace)
				.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
			const current = careerWorkspaceSchema.parse({ ...EMPTY_WORKSPACE, ...workspace?.data });
			// A lost success response may be retried only while the committed submission still matches.
			// Draft equality alone also matches a never-submitted application closed in another tab.
			if (application.status !== "saved") {
				const conflict = () =>
					new ORPCError("CONFLICT", {
						message: "This application has changed since submission. Reload it before continuing.",
					});
				const applied = application.activity.findLast(
					(entry) => entry.type === "stage" && entry.stage === "applied" && entry.canonicalTransition !== false,
				);
				if (application.status !== "applied" || !applied || !isDeepStrictEqual(current.answers, parsed))
					throw conflict();
				const sent = parsed.filter((answer) => answer.answer.trim());
				if (sent.length) {
					const [snapshot] = await tx
						.select({ id: tables.careerArtifact.id })
						.from(tables.careerArtifact)
						.where(
							and(
								eq(tables.careerArtifact.userId, userId),
								eq(tables.careerArtifact.applicationId, applicationId),
								eq(tables.careerArtifact.inputVersion, hash(JSON.stringify([applicationId, applied.at, sent]))),
							),
						);
					if (!snapshot) throw conflict();
				}
				if (application.resumeId) {
					if (!application.sentResumeVersionId) throw conflict();
					const [version] = await tx
						.select({ id: tables.resumeVersion.id })
						.from(tables.resumeVersion)
						.where(
							and(
								eq(tables.resumeVersion.id, application.sentResumeVersionId),
								eq(tables.resumeVersion.resumeId, application.resumeId),
								eq(tables.resumeVersion.userId, userId),
							),
						);
					if (!version) throw conflict();
				}
				if (application.coverLetterId) {
					if (!application.sentCoverLetterVersionId) throw conflict();
					const [version] = await tx
						.select({ id: tables.coverLetterVersion.id })
						.from(tables.coverLetterVersion)
						.where(
							and(
								eq(tables.coverLetterVersion.id, application.sentCoverLetterVersionId),
								eq(tables.coverLetterVersion.coverLetterId, application.coverLetterId),
								eq(tables.coverLetterVersion.userId, userId),
							),
						);
					if (!version) throw conflict();
				}
				return { stages: [] };
			}
			if (!isDeepStrictEqual(current.answers, expectedAnswers) && !isDeepStrictEqual(current.answers, parsed))
				throw new ORPCError("CONFLICT", {
					message: "Application answers changed elsewhere. Review them before marking as applied.",
				});
			const at = new Date();
			const { values } = await applicationTransitionValues(tx, userId, { status: "applied" }, application, at);
			const [submitted] = await tx
				.update(tables.application)
				.set({
					...values,
				})
				.where(eq(tables.application.id, applicationId))
				.returning();
			if (!submitted) throw new ORPCError("NOT_FOUND");
			await recordSentResume(submitted, tx);
			const data = { ...current, answers: parsed };
			await tx
				.insert(tables.careerWorkspace)
				.values({ applicationId, userId, data })
				.onConflictDoUpdate({ target: tables.careerWorkspace.applicationId, set: { data, updatedAt: at } });
			const sent = parsed.filter((answer) => answer.answer.trim());
			if (sent.length)
				await tx.insert(tables.careerArtifact).values({
					userId,
					applicationId,
					interviewId: null,
					title: "Application answers",
					data: { kind: "answers", answers: sent },
					evidence: { factIds: await ownedFactIds(tx, userId, sent), storyIds: [] },
					inputVersion: hash(JSON.stringify([applicationId, at, sent])),
				});
			return { stages: [savedStageOf(submitted)] };
		});
	},
	/** Copies the workspace's answers into Saved when the application is marked as applied: what was sent. */
	snapshotAnswers: (userId: string, applicationId: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [application] = await tx
				.select()
				.from(tables.application)
				.where(and(eq(tables.application.id, applicationId), eq(tables.application.userId, userId)))
				.for("update");
			if (!application) throw new ORPCError("NOT_FOUND");
			if (application.status === "saved")
				throw new ORPCError("BAD_REQUEST", {
					message: "Mark the application as applied before recording sent answers.",
				});
			const [existing] = await tx
				.select({ id: tables.careerArtifact.id })
				.from(tables.careerArtifact)
				.where(
					and(
						eq(tables.careerArtifact.applicationId, applicationId),
						eq(tables.careerArtifact.userId, userId),
						sql`${tables.careerArtifact.data}->>'kind' = 'answers'`,
					),
				);
			if (existing) return;
			const [workspace] = await tx
				.select()
				.from(tables.careerWorkspace)
				.where(and(eq(tables.careerWorkspace.applicationId, applicationId), eq(tables.careerWorkspace.userId, userId)));
			const answers = careerWorkspaceSchema
				.parse({ ...EMPTY_WORKSPACE, ...workspace?.data })
				.answers.filter((answer) => answer.answer.trim());
			if (!answers.length) return;
			const applied = application.activity.findLast(
				(entry) => entry.type === "stage" && entry.stage === "applied" && entry.canonicalTransition !== false,
			);
			if (!applied || !workspace || workspace.updatedAt.getTime() >= new Date(applied.at).getTime())
				throw new ORPCError("CONFLICT", {
					message: "These answers changed after submission and cannot be recorded as sent.",
				});
			await tx.insert(tables.careerArtifact).values({
				userId,
				applicationId,
				interviewId: null,
				title: "Application answers",
				data: { kind: "answers", answers },
				evidence: { factIds: await ownedFactIds(tx, userId, answers), storyIds: [] },
				inputVersion: hash(JSON.stringify(answers)),
			});
		}),
	/** Saves a discovered role to Applications at Saved, with the posting link and why it matched. */
	trackOpportunity: (userId: string, id: string) => {
		// The opportunity row is the lock: a double click or a second tab returns the same application.
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [opportunity] = await tx
				.select()
				.from(tables.careerOpportunity)
				.where(and(eq(tables.careerOpportunity.id, id), eq(tables.careerOpportunity.userId, userId)))
				.for("update");
			if (!opportunity) throw new ORPCError("NOT_FOUND");
			if (opportunity.trackedApplicationId) return { applicationId: opportunity.trackedApplicationId };
			if (opportunity.dismissedAt)
				throw new ORPCError("CONFLICT", { message: "This role was dismissed. Refresh the review queue." });
			const [profile] = await tx.select().from(tables.careerProfile).where(eq(tables.careerProfile.userId, userId));
			const { matches } = matchPosting(opportunity, careerProfileDataSchema.parse(profile?.data ?? {}));
			const duplicate = await findTrackedPosting(tx, userId, opportunity.url);
			const applicationId = duplicate?.id ?? generateId();
			const { values } = await applicationTransitionValues(tx, userId, { status: "saved" });
			if (!duplicate)
				await tx.insert(tables.application).values({
					id: applicationId,
					userId,
					company: opportunity.company || new URL(opportunity.url).hostname.replace(/^www\./, ""),
					role: opportunity.role,
					location: opportunity.location || null,
					sourceUrl: opportunity.url,
					jobDescription: opportunity.description || opportunity.snippet,
					...values,
					...(matches.length ? { notes: `Matched: ${matches.join(" · ")}` } : {}),
				});
			await tx
				.update(tables.careerOpportunity)
				.set({ trackedApplicationId: applicationId })
				.where(eq(tables.careerOpportunity.id, id));
			return { applicationId };
		});
	},
	exportData: async (userId: string) => {
		const [
			profile,
			facts,
			stories,
			artifacts,
			schedules,
			notifications,
			threads,
			messages,
			attachments,
			opportunities,
			jobs,
			transcripts,
			workspaces,
			reviewedAnswers,
		] = await Promise.all([
			careerService.profile(userId),
			db.select().from(tables.careerFact).where(eq(tables.careerFact.userId, userId)),
			db.select().from(tables.careerStory).where(eq(tables.careerStory.userId, userId)),
			db.select().from(tables.careerArtifact).where(eq(tables.careerArtifact.userId, userId)),
			db.select().from(tables.careerSchedule).where(eq(tables.careerSchedule.userId, userId)),
			db.select().from(tables.careerNotification).where(eq(tables.careerNotification.userId, userId)),
			db
				.select()
				.from(tables.agentThread)
				.where(and(eq(tables.agentThread.userId, userId), isNull(tables.agentThread.deletedAt))),
			// Messages of live conversations only: a deleted conversation's words aren't part of the account any more.
			db
				.select()
				.from(tables.agentMessage)
				.where(
					and(
						eq(tables.agentMessage.userId, userId),
						inArray(
							tables.agentMessage.threadId,
							db
								.select({ id: tables.agentThread.id })
								.from(tables.agentThread)
								.where(and(eq(tables.agentThread.userId, userId), isNull(tables.agentThread.deletedAt))),
						),
					),
				),
			db.select().from(tables.agentAttachment).where(eq(tables.agentAttachment.userId, userId)),
			db.select().from(tables.careerOpportunity).where(eq(tables.careerOpportunity.userId, userId)),
			db.select().from(tables.careerJob).where(eq(tables.careerJob.userId, userId)),
			db.select().from(tables.careerTranscript).where(eq(tables.careerTranscript.userId, userId)),
			db.select().from(tables.careerWorkspace).where(eq(tables.careerWorkspace.userId, userId)),
			db.select().from(tables.careerAnswer).where(eq(tables.careerAnswer.userId, userId)),
		]);
		return {
			profile,
			facts,
			stories,
			artifacts,
			schedules,
			notifications: notifications.map((row) => ({ ...row, ...noticeText(row.notice) })),
			threads,
			messages,
			attachments,
			opportunities,
			jobs,
			transcripts,
			workspaces,
			reviewedAnswers,
		};
	},
};
