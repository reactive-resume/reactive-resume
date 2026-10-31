import type { DbOrTx } from "@reactive-resume/db/client";
import type { ProposalApplications } from "@reactive-resume/resume/proposals";
import type { UIMessage } from "ai";
import { and, asc, eq, isNull } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";
import { lockThreadMessages, proposedEditsOf, withEditStatuses } from "./messages-persistence";

/** Called inside the document's ownership/version-checked transaction: content and decisions commit together. */
export async function saveProposalApplications(
	tx: Pick<DbOrTx, "select" | "update">,
	input: {
		userId: string;
		document: { kind: "resume" | "letter"; id: string };
		applications: ProposalApplications | undefined;
	},
) {
	if (!input.applications || Object.keys(input.applications).length === 0) return;
	const threads = await tx
		.select({ id: schema.agentThread.id })
		.from(schema.agentThread)
		.where(
			and(
				eq(schema.agentThread.userId, input.userId),
				input.document.kind === "letter"
					? eq(schema.agentThread.coverLetterId, input.document.id)
					: and(eq(schema.agentThread.workingResumeId, input.document.id), isNull(schema.agentThread.coverLetterId)),
			),
		)
		.orderBy(asc(schema.agentThread.id));
	for (const thread of threads) {
		const rows = await lockThreadMessages(tx, { threadId: thread.id, userId: input.userId });
		let accepted = 0;
		for (const row of rows) {
			const original = row.uiMessage as unknown as UIMessage;
			if (!Array.isArray(original?.parts)) continue;
			const decisions = new Map(
				proposedEditsOf(original).flatMap((edit) => {
					const applied = input.applications?.[edit.id];
					// Explicit rejection wins over old draft saves and history movement.
					return typeof applied === "boolean" && edit.status !== "rejected"
						? [[edit.id, applied ? ("accepted" as const) : ("pending" as const)] as const]
						: [];
				}),
			);
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
