import type { CoverLetterListInput, CoverLetterUpdateInput } from "../../dto/cover-letter";
import type { DbOrTx } from "@reactive-resume/db/client";
import type {
	CoverLetter,
	CoverLetterDocument,
	CoverLetterLayout,
	CoverLetterStyle,
} from "@reactive-resume/schema/cover-letter/data";
import type { Template } from "@reactive-resume/schema/templates";
import { ORPCError } from "@orpc/client";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { SUBMITTED_DOCUMENT_LOCKED } from "@reactive-resume/schema/applications/errors";
import {
	coverLetterContentSchema,
	coverLetterDocumentSchema,
	coverLetterSchema,
} from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { coverLetterDto } from "../../dto/cover-letter";
import {
	assertCurrentClientWrite,
	CurrentClientRequired,
	saveProposalApplications,
} from "../agent/proposal-applications";
import { lockUser } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { sanitizeCoverLetterHtml } from "./html";
import { getLetterVersion, saveLetterSessionVersion, writeLetterVersion } from "./versions";

type OwnedId = { userId: string; id: string };
type RevisionInput = OwnedId & { expectedRevision: number };
type CreateInput = {
	userId: string;
	name: string;
	recipient?: string | undefined;
	content?: string | undefined;
	greeting?: string | null | undefined;
	signOff?: string | null | undefined;
	resumeId?: string | undefined;
	applicationId?: string | undefined;
	template?: Template | undefined;
	layout?: CoverLetterLayout | undefined;
	recipientName?: string | undefined;
	recipientCompany?: string | undefined;
	letterDate?: string | null | undefined;
};

/** A stored row as a letter. Links end with the resume they point at, so a letter without one isn't linked. */
function toLetter(row: typeof schema.coverLetter.$inferSelect): CoverLetter {
	const letter = coverLetterSchema.parse(row);
	return letter.sourceResumeId ? letter : { ...letter, senderLinked: false, designLinked: false };
}

/** The stored letter, with the copies in `style` as they are. */
async function getRow(input: OwnedId, reader: DbOrTx = db): Promise<CoverLetter> {
	const [row] = await reader
		.select()
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.id, input.id), eq(schema.coverLetter.userId, input.userId)));
	if (!row) throw new ORPCError("NOT_FOUND");
	return toLetter(row);
}

/**
 * A letter as it reads now: linked sender details and design come from its source resume as the resume is today.
 * If the resume is gone, the copies the letter keeps stand in.
 */
async function resolveLinks(letter: CoverLetter, userId: string, reader: DbOrTx = db): Promise<CoverLetter> {
	if (!(letter.senderLinked || letter.designLinked) || !letter.sourceResumeId) return letter;

	let linked: CoverLetterStyle;
	try {
		linked = await getResumeStyle(userId, letter.sourceResumeId, letter.style.sectionId, letter.style.itemId, reader);
	} catch {
		return letter;
	}

	return {
		...letter,
		style: {
			...letter.style,
			...(letter.senderLinked ? { basics: linked.basics, picture: linked.picture } : {}),
			...(letter.designLinked ? { metadata: linked.metadata } : {}),
		},
	};
}

async function getById(input: OwnedId, reader: DbOrTx = db): Promise<CoverLetter> {
	return resolveLinks(await getRow(input, reader), input.userId, reader);
}

/** Today as YYYY-MM-DD, the date a new letter starts with. */
const today = () => new Date().toISOString().slice(0, 10);

async function getResumeStyle(
	userId: string,
	resumeId?: string,
	sectionId?: string,
	itemId?: string,
	reader: DbOrTx = db,
) {
	const data = resumeId
		? resumeDataSchema.parse((await resumeService.getById({ userId, id: resumeId }, reader)).data)
		: defaultResumeData;
	return copyCoverLetterStyle(data, sectionId, itemId);
}

async function getOwnedApplication(userId: string, id?: string) {
	if (!id) return null;
	const [application] = await db
		.select({ id: schema.application.id, company: schema.application.company, contacts: schema.application.contacts })
		.from(schema.application)
		.where(and(eq(schema.application.id, id), eq(schema.application.userId, userId)));
	if (!application) throw new ORPCError("NOT_FOUND");
	return application;
}

async function assertOwnedApplication(userId: string, id?: string) {
	await getOwnedApplication(userId, id);
}

type LinkLetterApplicationInput = {
	userId: string;
	letterId: string;
	from?: string | null | undefined;
} & ({ to: string; replace: boolean } | { to: null; clearFrom: string } | { to: null; unlinkAll: true });

const submittedDocumentLocked = () =>
	new ORPCError("BAD_REQUEST", {
		message: "Recorded submitted documents cannot be replaced. Prepare a copy to keep the submitted versions intact.",
		data: { reason: SUBMITTED_DOCUMENT_LOCKED },
	});

type ReverseAliasUpdate = { id: string; sourceApplicationId: string | null };

/**
 * Plans the reverse side of a link change. It locks the letter actually being displaced (even when its reverse is
 * null) and every letter that still points at an application being detached or cleared. A claiming application keeps
 * its reverse link; a reverse-only alias loses it. Any locked affected letter refuses before an application or letter
 * write. The caller applies the plan after its application writes.
 */
async function planReverseAliases(
	client: DbOrTx,
	input: {
		userId: string;
		letterId: string;
		detachedApplicationIds: (string | null | undefined)[];
		displacedLetterId?: string | null;
	},
): Promise<ReverseAliasUpdate[]> {
	const detached = [...new Set(input.detachedApplicationIds.filter((id): id is string => Boolean(id)))];
	const displaced =
		input.displacedLetterId && input.displacedLetterId !== input.letterId ? input.displacedLetterId : null;
	if (!detached.length && !displaced) return [];
	const scope = or(
		...(displaced ? [eq(schema.coverLetter.id, displaced)] : []),
		...(detached.length
			? [and(inArray(schema.coverLetter.sourceApplicationId, detached), ne(schema.coverLetter.id, input.letterId))]
			: []),
	);
	const letters = await client
		.select({
			id: schema.coverLetter.id,
			sourceApplicationId: schema.coverLetter.sourceApplicationId,
			isLocked: schema.coverLetter.isLocked,
		})
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.userId, input.userId), scope))
		.orderBy(asc(schema.coverLetter.id))
		.for("update");
	if (letters.some((row) => row.isLocked))
		throw new ORPCError("DOCUMENT_LOCKED", { status: 400, message: "Unlock the letter first." });

	const reverseIds = letters
		.filter(
			(row) =>
				row.id !== input.letterId && row.sourceApplicationId !== null && detached.includes(row.sourceApplicationId),
		)
		.map((row) => row.id);
	if (!reverseIds.length) return [];
	const claimed = await client
		.select({ id: schema.application.id, coverLetterId: schema.application.coverLetterId })
		.from(schema.application)
		.where(and(eq(schema.application.userId, input.userId), inArray(schema.application.coverLetterId, reverseIds)))
		.orderBy(asc(schema.application.id))
		.for("update");
	const owners = claimed.filter((row) => !detached.includes(row.id));
	return reverseIds.map((id) => {
		const found = owners.filter((row) => row.coverLetterId === id);
		if (found.length > 1)
			throw new ORPCError("CONFLICT", {
				message: "This letter is linked to more than one application. Review the documents before changing the link.",
			});
		return { id, sourceApplicationId: found[0]?.id ?? null };
	});
}

async function applyReverseAliases(client: DbOrTx, userId: string, updates: ReverseAliasUpdate[]) {
	for (const update of updates)
		await client
			.update(schema.coverLetter)
			.set({ sourceApplicationId: update.sourceApplicationId, revision: sql`${schema.coverLetter.revision} + 1` })
			.where(and(eq(schema.coverLetter.userId, userId), eq(schema.coverLetter.id, update.id)));
}

/**
 * The one owner of the application ↔ letter pointer. A move takes the letter from every application that names it
 * (including legacy aliases that `sourceApplicationId` does not know about), sets the target and clears the letter it
 * displaced. A clear removes only the application it is told to clear, and the reverse link only when it names that
 * same application. An unlink removes every application that still names the letter. Every change is refused when the
 * application holds a submitted version.
 */
async function linkLetterApplication(client: DbOrTx, input: LinkLetterApplicationInput) {
	const table = schema.application;
	const identityIds = [input.from, input.to, "clearFrom" in input ? input.clearFrom : undefined].filter(
		(id): id is string => Boolean(id),
	);
	const namesLetter = eq(table.coverLetterId, input.letterId);
	const identity = identityIds.length ? or(namesLetter, inArray(table.id, identityIds)) : namesLetter;
	const applications = await client
		.select({ id: table.id, coverLetterId: table.coverLetterId, sentVersion: table.sentCoverLetterVersionId })
		.from(table)
		.where(and(eq(table.userId, input.userId), identity))
		.orderBy(asc(table.id))
		.for("update");

	const clear = async (application: (typeof applications)[number]) => {
		if (application.sentVersion) throw submittedDocumentLocked();
		await client
			.update(table)
			.set({ coverLetterId: null })
			.where(and(eq(table.id, application.id), eq(table.userId, input.userId)));
	};

	if (input.to !== null) {
		const target = applications.find((application) => application.id === input.to);
		if (!target) throw new ORPCError("NOT_FOUND");
		const cleared = applications.filter(
			(application) => application.coverLetterId === input.letterId && application.id !== input.to,
		);
		// Both directions: forward aliases naming the incoming letter, the letter displaced from the target, and
		// reverse aliases of every application actually being cleared. A stale source identity is not authority.
		const reverseUpdates = await planReverseAliases(client, {
			userId: input.userId,
			letterId: input.letterId,
			detachedApplicationIds: [input.to, ...cleared.map((application) => application.id)],
			displacedLetterId: target.coverLetterId && target.coverLetterId !== input.letterId ? target.coverLetterId : null,
		});
		for (const application of applications) {
			if (application.id === input.to) {
				if (application.coverLetterId === input.letterId) continue;
				if (application.sentVersion) throw submittedDocumentLocked();
				await client
					.update(table)
					.set({ coverLetterId: input.letterId })
					.where(and(eq(table.id, application.id), eq(table.userId, input.userId)));
				continue;
			}
			// Every other application that still names this letter is a legacy alias, or the previous owner.
			if (application.coverLetterId === input.letterId) await clear(application);
		}
		await applyReverseAliases(client, input.userId, reverseUpdates);
		return;
	}

	if ("clearFrom" in input) {
		const application = applications.find((candidate) => candidate.id === input.clearFrom);
		if (application?.coverLetterId === input.letterId) await clear(application);
		return;
	}

	// Letter-side unlink: every application that still names the letter lets it go, and reverse aliases of those
	// cleared applications are detached or repaired to their actual forward owner.
	const cleared = applications.filter((application) => application.coverLetterId === input.letterId);
	const reverseUpdates = await planReverseAliases(client, {
		userId: input.userId,
		letterId: input.letterId,
		detachedApplicationIds: cleared.map((application) => application.id),
	});
	for (const application of cleared) await clear(application);
	await applyReverseAliases(client, input.userId, reverseUpdates);
}

/**
 * Points a letter at an application (or clears it) from the application side. Reuses linkLetterApplication so legacy
 * aliases, the new job, any displaced letter and submitted locks move exactly as they do from the letter side, then
 * keeps the letter's sourceApplicationId in step in the same transaction. The caller owns the transaction and has
 * locked the user. A clear carries the application being cleared so an unrelated canonical owner is never detached.
 */
export async function linkLetterToApplication(
	client: DbOrTx,
	input: { userId: string; letterId: string; applicationId: string | null; clearApplicationId?: string | null },
) {
	const [stored] = await client
		.select({
			revision: schema.coverLetter.revision,
			sourceApplicationId: schema.coverLetter.sourceApplicationId,
			isLocked: schema.coverLetter.isLocked,
		})
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.id, input.letterId), eq(schema.coverLetter.userId, input.userId)))
		.for("update");
	if (!stored) throw new ORPCError("NOT_FOUND");
	if (input.applicationId !== null) {
		// A no-op equal-ID save may still reconcile aliases, but it must not need to write a locked letter.
		const writeLetter = stored.sourceApplicationId !== input.applicationId;
		if (stored.isLocked && writeLetter)
			throw new ORPCError("DOCUMENT_LOCKED", { status: 400, message: "Unlock the letter first." });
		await linkLetterApplication(client, {
			userId: input.userId,
			letterId: input.letterId,
			from: stored.sourceApplicationId,
			to: input.applicationId,
			replace: true,
		});
		if (writeLetter)
			await updateRevision(
				{ userId: input.userId, id: input.letterId, expectedRevision: stored.revision },
				{ sourceApplicationId: input.applicationId },
				client,
			);
		return;
	}

	const clearFrom = input.clearApplicationId ?? stored.sourceApplicationId;
	if (!clearFrom) return;
	// Every application actually cleared inventories its reverse aliases, even when the incoming letter's reverse is
	// stale or null. A locked alias that would need changing refuses before any application write.
	const reverseUpdates = await planReverseAliases(client, {
		userId: input.userId,
		letterId: input.letterId,
		detachedApplicationIds: [clearFrom],
	});
	// The cleared application was a forward owner of this letter. Resolve the surviving forward owners; at most one
	// may remain. The letter's reverse follows that owner instead of being blindly nulled.
	const survivors = await client
		.select({ id: schema.application.id })
		.from(schema.application)
		.where(
			and(
				eq(schema.application.userId, input.userId),
				eq(schema.application.coverLetterId, input.letterId),
				ne(schema.application.id, clearFrom),
			),
		)
		.orderBy(asc(schema.application.id))
		.for("update");
	if (survivors.length > 1)
		throw new ORPCError("CONFLICT", {
			message: "This letter is linked to more than one application. Review the documents before changing the link.",
		});
	const nextSource = survivors[0]?.id ?? null;
	const changesSource = nextSource !== stored.sourceApplicationId;
	if (changesSource && stored.isLocked)
		throw new ORPCError("DOCUMENT_LOCKED", { status: 400, message: "Unlock the letter first." });
	await linkLetterApplication(client, {
		userId: input.userId,
		letterId: input.letterId,
		from: stored.sourceApplicationId,
		to: null,
		clearFrom,
	});
	await applyReverseAliases(client, input.userId, reverseUpdates);
	if (changesSource)
		await updateRevision(
			{ userId: input.userId, id: input.letterId, expectedRevision: stored.revision },
			{ sourceApplicationId: nextSource },
			client,
		);
}

async function insert(
	input: {
		userId: string;
		name: string;
		recipient: string;
		content: string;
		greeting?: string | null | undefined;
		signOff?: string | null | undefined;
		style: CoverLetterStyle;
		layout?: CoverLetterLayout | undefined;
		recipientName?: string | undefined;
		recipientCompany?: string | undefined;
		letterDate?: string | null | undefined;
		sourceResumeId?: string | null;
		sourceApplicationId?: string | null;
		senderLinked?: boolean;
		designLinked?: boolean;
	},
	client: DbOrTx = db,
): Promise<CoverLetter> {
	if (client === db)
		return db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return insert(input, tx);
		});
	const content = coverLetterContentSchema.parse(input);
	const [row] = await client
		.insert(schema.coverLetter)
		.values({
			...content,
			userId: input.userId,
			recipient: sanitizeCoverLetterHtml(content.recipient),
			content: sanitizeCoverLetterHtml(content.content),
			sourceResumeId: input.sourceResumeId ?? null,
			sourceApplicationId: input.sourceApplicationId ?? null,
			senderLinked: input.senderLinked ?? false,
			designLinked: input.designLinked ?? false,
		})
		.returning();
	if (!row) throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't save the letter. Try again." });
	const letter = toLetter(row);
	await writeLetterVersion(client, { letter, userId: input.userId, kind: "created" });
	return letter;
}

const letterConflict = () =>
	new ORPCError("CONFLICT", { message: "This cover letter changed elsewhere. Reload it before saving again." });

/**
 * `guard`: a client's content change, refused before anything is written when the letter holds assistant edits an
 * older app could apply wrongly (see assertCurrentClientWrite).
 */
async function updateRevision(
	input: RevisionInput,
	changes: Partial<typeof schema.coverLetter.$inferInsert>,
	client: DbOrTx = db,
	guard?: { proposalSafety: "v1" | undefined },
): Promise<CoverLetter> {
	if (client === db)
		return db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			return updateRevision(input, changes, tx, guard);
		});
	if (guard && changes.content !== undefined)
		await assertCurrentClientWrite(client, {
			userId: input.userId,
			document: { kind: "letter", id: input.id },
			proposalSafety: guard.proposalSafety,
		});
	const [row] = await client
		.update(schema.coverLetter)
		.set({ ...changes, revision: sql`${schema.coverLetter.revision} + 1` })
		.where(
			and(
				eq(schema.coverLetter.id, input.id),
				eq(schema.coverLetter.userId, input.userId),
				eq(schema.coverLetter.revision, input.expectedRevision),
				eq(schema.coverLetter.isLocked, false),
			),
		)
		.returning();
	if (row) return toLetter(row);
	await assertUnlocked(input, client);
	throw letterConflict();
}

/**
 * An older app tried to change a letter holding assistant edits it could apply wrongly. Nothing it sent is written;
 * the revision moves on so a draft it kept conflicts too, and it reloads the letter as for any other conflict.
 */
async function refuseOlderClient(input: OwnedId) {
	await db
		.update(schema.coverLetter)
		.set({ revision: sql`${schema.coverLetter.revision} + 1` })
		.where(and(eq(schema.coverLetter.id, input.id), eq(schema.coverLetter.userId, input.userId)));
	return new ORPCError("CONFLICT", {
		message:
			"This cover letter has assistant edits this version of the app can't check. Refresh or update the app, then make the change again.",
		data: { reason: "CURRENT_CLIENT_REQUIRED" },
	});
}

/** Locked letters, like locked resumes, can't be edited or moved to Trash. */
async function assertUnlocked(input: OwnedId, client: DbOrTx = db) {
	const [row] = await client
		.select({ isLocked: schema.coverLetter.isLocked })
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.id, input.id), eq(schema.coverLetter.userId, input.userId)));
	if (!row) throw new ORPCError("NOT_FOUND");
	if (row.isLocked) throw new ORPCError("DOCUMENT_LOCKED", { status: 400, message: "Unlock the letter first." });
}

export const coverLetterService = {
	getById,
	list: async (input: CoverLetterListInput & { userId: string }) => {
		const filters = [eq(schema.coverLetter.userId, input.userId), isNull(schema.coverLetter.trashedAt)];
		if (input.resumeId) filters.push(eq(schema.coverLetter.sourceResumeId, input.resumeId));
		if (input.applicationId) filters.push(eq(schema.coverLetter.sourceApplicationId, input.applicationId));
		if (input.search?.trim())
			filters.push(ilike(schema.coverLetter.name, `%${input.search.trim().replace(/[\\%_]/g, "\\$&")}%`));
		const where = and(...filters);
		const [rows, totals] = await Promise.all([
			db
				.select()
				.from(schema.coverLetter)
				.where(where)
				.orderBy(desc(schema.coverLetter.updatedAt), desc(schema.coverLetter.id))
				.limit(input.limit)
				.offset(input.offset),
			db.select({ total: count() }).from(schema.coverLetter).where(where),
		]);
		return { items: rows.map(toLetter), total: totals[0]?.total ?? 0 };
	},
	/**
	 * New letters are structured, with the recipient filled from the application (its company and first contact),
	 * and linked to their resume's sender details and design. A letter given a recipient block stays freeform.
	 */
	create: async (input: CreateInput) => {
		const application = await getOwnedApplication(input.userId, input.applicationId);
		const style = await getResumeStyle(input.userId, input.resumeId);
		if (input.template) style.metadata.template = input.template;
		const linked = Boolean(input.resumeId) && !input.template;
		const letter = await db.transaction(async (tx) => {
			await lockUser(tx, input.userId);
			const letter = await insert(
				{
					userId: input.userId,
					name: input.name,
					recipient: input.recipient ?? "",
					content: input.content ?? "",
					greeting: input.greeting ?? null,
					signOff: input.signOff ?? null,
					style,
					layout: input.layout ?? (input.recipient?.trim() ? "freeform" : "structured"),
					recipientName: input.recipientName ?? application?.contacts[0]?.name ?? "",
					recipientCompany: input.recipientCompany ?? application?.company ?? "",
					letterDate: input.letterDate === undefined ? today() : input.letterDate,
					sourceResumeId: input.resumeId ?? null,
					sourceApplicationId: input.applicationId ?? null,
					senderLinked: Boolean(input.resumeId),
					designLinked: linked,
				},
				tx,
			);
			// A new letter written for an application becomes that application's letter; an older letter is displaced.
			if (input.applicationId)
				await linkLetterApplication(tx, {
					userId: input.userId,
					letterId: letter.id,
					to: input.applicationId,
					replace: true,
				});
			return letter;
		});
		return resolveLinks(letter, input.userId);
	},
	update: async (input: CoverLetterUpdateInput & { userId: string }) => {
		const changes: Partial<typeof schema.coverLetter.$inferInsert> = {};
		const stored = await getRow(input);

		if (input.resumeId !== undefined) {
			if (input.resumeId) await resumeService.getById({ userId: input.userId, id: input.resumeId });
			changes.sourceResumeId = input.resumeId;
		}
		if (input.applicationId !== undefined) {
			await assertOwnedApplication(input.userId, input.applicationId ?? undefined);
			changes.sourceApplicationId = input.applicationId;
		}

		const sourceResumeId = changes.sourceResumeId !== undefined ? changes.sourceResumeId : stored.sourceResumeId;
		if ((input.senderLinked || input.designLinked) && !sourceResumeId) {
			throw new ORPCError("BAD_REQUEST", { message: "Choose a resume to link the letter to first." });
		}

		// Links follow the letter's resume and end when it's cleared; choosing a template or design ends the design link.
		const ownDesign = Boolean(input.template || input.metadata);
		const senderLinked = Boolean(sourceResumeId) && (input.senderLinked ?? stored.senderLinked);
		const designLinked = Boolean(sourceResumeId) && !ownDesign && (input.designLinked ?? stored.designLinked);

		// Unlinking keeps the details and design exactly as they read at that moment.
		if ((stored.senderLinked && !senderLinked) || (stored.designLinked && !designLinked)) {
			changes.style = (await resolveLinks(stored, input.userId)).style;
		}
		changes.senderLinked = senderLinked;
		changes.designLinked = designLinked;

		if (input.sender !== undefined) {
			if (senderLinked)
				throw new ORPCError("BAD_REQUEST", { message: "Turn off the sender link before editing sender details." });
			const style = changes.style ?? stored.style;
			const { picture, ...sender } = coverLetterDto.update.input.shape.sender.unwrap().parse(input.sender);
			const fields = Object.fromEntries(Object.entries(sender).filter(([, value]) => value !== undefined));
			changes.style = {
				...style,
				basics: { ...style.basics, ...fields },
				picture: picture ? { ...style.picture, ...picture } : style.picture,
			};
		}

		if (input.template) {
			const style = changes.style ?? stored.style;
			changes.style = { ...style, metadata: { ...style.metadata, template: input.template } };
		}
		if (input.metadata) {
			const style = changes.style ?? stored.style;
			const set = Object.fromEntries(Object.entries(input.metadata).filter(([, value]) => value !== undefined));
			changes.style = { ...style, metadata: { ...style.metadata, ...(set as Partial<typeof style.metadata>) } };
		}
		if (input.name !== undefined) changes.name = coverLetterContentSchema.shape.name.parse(input.name);
		if (input.recipient !== undefined)
			changes.recipient = sanitizeCoverLetterHtml(coverLetterContentSchema.shape.recipient.parse(input.recipient));
		if (input.content !== undefined)
			changes.content = sanitizeCoverLetterHtml(coverLetterContentSchema.shape.content.parse(input.content));
		if (input.greeting !== undefined) changes.greeting = coverLetterContentSchema.shape.greeting.parse(input.greeting);
		if (input.signOff !== undefined) changes.signOff = coverLetterContentSchema.shape.signOff.parse(input.signOff);
		if (input.recipientName !== undefined) changes.recipientName = input.recipientName.trim();
		if (input.recipientCompany !== undefined) changes.recipientCompany = input.recipientCompany.trim();
		if (input.letterDate !== undefined) changes.letterDate = input.letterDate;

		const persist = async (client: DbOrTx) => {
			const updated = await updateRevision(input, changes, client, { proposalSafety: input.proposalSafety });
			await saveProposalApplications(client, {
				userId: input.userId,
				document: { kind: "letter", id: input.id },
				applications: input.proposalApplications,
				conflict: letterConflict,
			});
			if (input.applicationId === null) {
				await linkLetterApplication(client, {
					userId: input.userId,
					letterId: input.id,
					from: stored.sourceApplicationId,
					to: null,
					unlinkAll: true,
				});
			} else if (input.applicationId !== undefined) {
				await linkLetterApplication(client, {
					userId: input.userId,
					letterId: input.id,
					from: stored.sourceApplicationId,
					to: input.applicationId,
					replace: true,
				});
			}
			return updated;
		};
		const updated = await resolveLinks(
			await (
				input.applicationId === undefined && !input.proposalApplications
					? persist(db)
					: db.transaction(async (tx) => {
							await lockUser(tx, input.userId);
							return persist(tx);
						})
			).catch(async (error: unknown) => {
				throw error instanceof CurrentClientRequired ? await refuseOlderClient(input) : error;
			}),
			input.userId,
		);
		await saveLetterSessionVersion({
			letter: updated,
			userId: input.userId,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
		});
		return updated;
	},
	refreshStyle: async (input: RevisionInput & { resumeId: string }) => {
		const letter = await getById(input);
		const style = await getResumeStyle(input.userId, input.resumeId, letter.style.sectionId, letter.style.itemId);
		if (!letter.senderLinked) {
			style.basics = letter.style.basics;
			style.picture = letter.style.picture;
		}
		style.metadata.template = letter.style.metadata.template;
		return resolveLinks(await updateRevision(input, { style, sourceResumeId: input.resumeId }), input.userId);
	},
	duplicate: async (input: OwnedId & { name?: string | undefined }) => {
		const letter = await getRow(input);
		const copy = await insert({
			...letter,
			userId: input.userId,
			name: input.name ?? `${letter.name} (copy)`.slice(0, 100),
			// A copy is a new document, not a second owner of the original's application.
			sourceApplicationId: null,
		});
		return resolveLinks(copy, input.userId);
	},
	/** Moves the letter to Trash (30 days, then deleted); Trash offers Restore and Delete now. */
	delete: async (input: RevisionInput): Promise<void> => {
		const rows = await db
			.update(schema.coverLetter)
			.set({ trashedAt: new Date(), revision: sql`${schema.coverLetter.revision} + 1` })
			.where(
				and(
					eq(schema.coverLetter.id, input.id),
					eq(schema.coverLetter.userId, input.userId),
					eq(schema.coverLetter.revision, input.expectedRevision),
					eq(schema.coverLetter.isLocked, false),
				),
			)
			.returning({ id: schema.coverLetter.id });
		if (rows.length) return;
		await assertUnlocked(input);
		throw new ORPCError("CONFLICT", { message: "This cover letter changed elsewhere. Reload it before deleting." });
	},
	export: async (input: OwnedId): Promise<CoverLetterDocument> => {
		const letter = await getById(input);
		return coverLetterDocumentSchema.parse({ ...letter, format: "reactive-resume-cover-letter", version: 1 });
	},
	/** "Name this version": a named version of the letter as it is now. */
	createVersion: async (input: OwnedId & { name: string }) => {
		const letter = await getById(input);
		return writeLetterVersion(db, { letter, userId: input.userId, kind: "named", name: input.name });
	},
	/**
	 * Restores a version: the current state is kept as "Before restore" first, then the letter reads as it did. Its
	 * links stay as they are, so linked details and design keep coming from the resume.
	 */
	restoreVersion: async (input: OwnedId & { versionId: string; proposalSafety?: "v1" | undefined }) => {
		const version = await getLetterVersion({
			coverLetterId: input.id,
			userId: input.userId,
			versionId: input.versionId,
		});
		const current = await getById(input);
		await writeLetterVersion(db, { letter: current, userId: input.userId, kind: "before-restore" });

		const { data } = version;
		const restored = await updateRevision(
			{ id: input.id, userId: input.userId, expectedRevision: current.revision },
			{
				name: data.name,
				recipient: data.recipient,
				content: data.content,
				greeting: data.greeting ?? null,
				signOff: data.signOff ?? null,
				style: data.style,
				layout: data.layout,
				recipientName: data.recipientName,
				recipientCompany: data.recipientCompany,
				letterDate: data.letterDate,
			},
			db,
			{ proposalSafety: input.proposalSafety },
		).catch(async (error: unknown) => {
			throw error instanceof CurrentClientRequired ? await refuseOlderClient(input) : error;
		});
		const resolved = await resolveLinks(restored, input.userId);
		await writeLetterVersion(db, { letter: resolved, userId: input.userId, kind: "restored" });
		return resolved;
	},
	/** The version an application was sent with ("sent", named after the company). */
	recordSent: async (input: OwnedId & { company: string }) => {
		const letter = await getById(input);
		return writeLetterVersion(db, { letter, userId: input.userId, kind: "sent", name: input.company });
	},
	import: (input: { userId: string; document: CoverLetterDocument }) => {
		const document = coverLetterDocumentSchema.parse(input.document);
		return insert({ ...document, userId: input.userId });
	},
};
