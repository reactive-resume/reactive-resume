import type { ProposedEdit, ProposeEditsOutput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { ProposalApplications } from "@reactive-resume/resume/proposals";
import type { UIMessage } from "ai";
import { and, asc, eq, isNull } from "drizzle-orm";
import { tailoringAllows } from "@reactive-resume/ai/tools/agent-tool-contracts";
import * as schema from "@reactive-resume/db/schema";
import { appliedApplications, canApplyTo, holdsProposal } from "@reactive-resume/resume/proposals";
import { parseStoredResumeData } from "../resume/resume-data-validation";
import { lockThreadMessages, proposedEditsOf, withEditStatuses } from "./messages-persistence";

type ProposalDocument = { kind: "resume" | "letter"; id: string };
type Reader = Pick<DbOrTx, "select">;

type HeldEdit = Pick<ProposedEdit, "id" | "after" | "target" | "snapshot">;

/** The document as it reads in this transaction: whether it holds an edit as proposed, and the job a resume was made for. */
export type DocumentReader = {
	kind: ProposalDocument["kind"];
	madeFor: string | null;
	holds: (edit: HeldEdit) => boolean;
};

export async function documentReader(
	tx: Reader,
	userId: string,
	document: ProposalDocument,
): Promise<DocumentReader | null> {
	if (document.kind === "resume") {
		const [row] = await tx
			.select({ data: schema.resume.data, applicationId: schema.resume.applicationId })
			.from(schema.resume)
			.where(and(eq(schema.resume.id, document.id), eq(schema.resume.userId, userId)));
		if (!row) return null;
		const data = parseStoredResumeData(row.data);
		return { kind: "resume", madeFor: row.applicationId, holds: (edit) => holdsProposal(data, edit) };
	}
	const [row] = await tx
		.select({ content: schema.coverLetter.content })
		.from(schema.coverLetter)
		.where(and(eq(schema.coverLetter.id, document.id), eq(schema.coverLetter.userId, userId)));
	if (!row) return null;
	return {
		kind: "letter",
		madeFor: null,
		holds: (edit) =>
			!edit.snapshot && edit.target.field === "content" && canApplyTo(row.content, { before: edit.after }),
	};
}

/**
 * Whether an edit may count as accepted on this document. The receipt contract (proposalApplicationsSchema):
 * - Tailoring has to allow the edit here (see tailoringAllows), whatever the client says.
 * - Current apps name the wording they applied: the edit's `after` as they reviewed it, or `snapshot:<id>` for a
 *   structural proposal, whose snapshot and summary cannot be reworded. Prior apps may still send that summary.
 *   Prose has to name the edit's current `after`,
 *   so wording another device changed since is refused. What the document now holds isn't compared: other edits at the
 *   same place, the user's refinements and undo/redo legitimately change it after the edit was applied.
 * - `true` (older apps, API clients) names no wording: the document has to hold the edit exactly as proposed (see
 *   holdsProposal), the only evidence of which version was applied.
 * The stored edit, never the client, supplies target, wording and snapshot.
 */
export function acceptedEditAllowed(
	message: UIMessage,
	output: unknown,
	edit: HeldEdit,
	reader: DocumentReader,
	reviewed: string | true,
) {
	return (
		(reader.kind !== "resume" || tailoringAllows(message, output, reader.madeFor)) &&
		(typeof reviewed === "string"
			? reviewed === edit.after || reviewed === appliedApplications([edit])[edit.id]
			: reader.holds(edit))
	);
}

const documentThreads = (tx: Reader, userId: string, document: ProposalDocument) =>
	tx
		.select({ id: schema.agentThread.id })
		.from(schema.agentThread)
		.where(
			and(
				eq(schema.agentThread.userId, userId),
				document.kind === "letter"
					? eq(schema.agentThread.coverLetterId, document.id)
					: and(eq(schema.agentThread.workingResumeId, document.id), isNull(schema.agentThread.coverLetterId)),
			),
		)
		.orderBy(asc(schema.agentThread.id));

const proposalSets = (message: UIMessage) =>
	message.parts.flatMap((part) => {
		const output = (part as { state?: string; output?: ProposeEditsOutput }).output;
		return part.type === "tool-propose_edits" && output?.edits ? [output] : [];
	});

/**
 * Called inside the document's ownership/version-checked transaction, after its content is written: content and
 * decisions commit together. An edit recorded as applied must have been applied in its current wording, with allowed
 * tailoring (see acceptedEditAllowed); otherwise `conflict()` is thrown and the whole save, content included, rolls back.
 */
export async function saveProposalApplications(
	tx: Pick<DbOrTx, "select" | "update">,
	input: {
		userId: string;
		document: ProposalDocument;
		applications: ProposalApplications | undefined;
		conflict: () => Error;
	},
) {
	if (!input.applications || Object.keys(input.applications).length === 0) return;
	const threads = await documentThreads(tx, input.userId, input.document);
	let reader: DocumentReader | null | undefined;
	for (const thread of threads) {
		const rows = await lockThreadMessages(tx, { threadId: thread.id, userId: input.userId });
		let accepted = 0;
		for (const row of rows) {
			const original = row.uiMessage as unknown as UIMessage;
			if (!Array.isArray(original?.parts)) continue;
			const decisions = new Map<string, "accepted" | "pending">();
			for (const output of proposalSets(original)) {
				for (const edit of output.edits) {
					const applied = input.applications[edit.id];
					// Explicit rejection wins over old draft saves and history movement.
					if (applied === undefined || edit.status === "rejected") continue;
					if (applied !== false && edit.status !== "accepted") {
						reader ??= await documentReader(tx, input.userId, input.document);
						if (!reader || !acceptedEditAllowed(original, output, edit, reader, applied)) throw input.conflict();
					}
					decisions.set(edit.id, applied === false ? "pending" : "accepted");
				}
			}
			const message = withEditStatuses(original, null, decisions);
			if (decisions.size > 0)
				await tx
					.update(schema.agentMessage)
					.set({ uiMessage: message as never })
					.where(and(eq(schema.agentMessage.id, row.id), eq(schema.agentMessage.userId, input.userId)));
			accepted += proposedEditsOf(message).filter((edit) => edit.status === "accepted").length;
		}
		await tx
			.update(schema.agentThread)
			.set({ editsAccepted: accepted })
			.where(and(eq(schema.agentThread.id, thread.id), eq(schema.agentThread.userId, input.userId)));
	}
}

/** A content save from a client without proposalSafety, to a document whose edits an older app could apply wrongly. */
export class CurrentClientRequired extends Error {
	constructor() {
		super("CURRENT_CLIENT_REQUIRED");
	}
}

/**
 * Before a content write, inside its transaction: a document with assistant edits that an older app could still apply
 * wrongly from what it holds refuses writes without `proposalSafety`. Those edits are tailoring this document can't
 * accept that isn't accepted (an older app may still show it pending), and any wording the user changed (an older app
 * may hold the previous wording). Unaffected documents, and current apps, are never refused.
 */
export async function assertCurrentClientWrite(
	tx: Reader,
	input: { userId: string; document: ProposalDocument; proposalSafety: "v1" | undefined },
) {
	if (input.proposalSafety === "v1") return;
	const threads = await documentThreads(tx, input.userId, input.document);
	if (threads.length === 0) return;
	const reader = await documentReader(tx, input.userId, input.document);
	for (const thread of threads) {
		const rows = await tx
			.select({ uiMessage: schema.agentMessage.uiMessage })
			.from(schema.agentMessage)
			.where(and(eq(schema.agentMessage.threadId, thread.id), eq(schema.agentMessage.userId, input.userId)));
		for (const { uiMessage } of rows) {
			const message = uiMessage as unknown as UIMessage;
			if (!Array.isArray(message?.parts)) continue;
			for (const output of proposalSets(message)) {
				const reworded = output.edits.some((edit) => edit.edited);
				const blockedTailoring =
					input.document.kind === "resume" &&
					!tailoringAllows(message, output, reader?.madeFor ?? null) &&
					output.edits.some((edit) => edit.status !== "accepted");
				if (reworded || blockedTailoring) throw new CurrentClientRequired();
			}
		}
	}
}
