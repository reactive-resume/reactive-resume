import type { Proposal } from "@reactive-resume/resume/proposals";
import type { QueryClient } from "@tanstack/react-query";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { toast } from "@reactive-resume/ui/components/toast";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { applicationsListQueryKey } from "@/features/applications/queries";
import { useNewDocumentsStore } from "@/features/documents/new-documents";
import { savePendingChanges, useResumeStore } from "@/features/resume/builder/draft";
import { acceptResumeProposals } from "@/features/resume/editor/proposals/proposals";
import { client, orpc } from "@/libs/orpc/client";

/** How long the copy has to open in the builder before its edits are left for the user to accept there. */
const OPEN_TIMEOUT_MS = 10_000;

type AcceptOnCopyInput = {
	threadId: string;
	resumeId: string;
	/** The application whose posting the conversation shares: the copy is named after it and made for it. */
	posting: { id: string } | null;
	proposals: readonly Proposal[];
	queryClient: QueryClient;
	/** Opens the copy in the builder with this conversation in the assistant. */
	open: (copyId: string) => Promise<unknown>;
};

const inFlight = new Set<string>();

const KEPT = () => t`Nothing was applied; the edits are still waiting.`;

/** Resolves once the builder holds `id`, or false when it hasn't opened in time. */
function opened(id: string) {
	const ready = () => {
		const state = useResumeStore.getState();
		return state.isReady && state.resume?.id === id;
	};
	if (ready()) return Promise.resolve(true);
	return new Promise<boolean>((resolve) => {
		const timeout = setTimeout(() => {
			unsubscribe();
			resolve(false);
		}, OPEN_TIMEOUT_MS);
		const unsubscribe = useResumeStore.subscribe(() => {
			if (!ready()) return;
			clearTimeout(timeout);
			unsubscribe();
			resolve(true);
		});
	});
}

/**
 * The first accepted edit on a resume the conversation started on: the assistant never edits it. A copy is made (for
 * the posting's job when there is one), the conversation moves to it, the copy opens and the edits are applied there.
 * When the copy or the move fails, nothing is applied and the edits stay pending.
 */
export async function acceptOnCopy({ threadId, resumeId, posting, proposals, queryClient, open }: AcceptOnCopyInput) {
	if (inFlight.has(threadId)) return;
	inFlight.add(threadId);
	try {
		if (!(await savePendingChanges(resumeId))) {
			toast.add({ type: "error", description: `${t`Save this resume's changes before copying it.`} ${KEPT()}` });
			return;
		}

		// A retry (a lost response, a second press) returns the copy already made.
		const key = `assistant-copy:${threadId}`;
		let copyId: string;
		try {
			copyId = await client.documents.copyForJob({
				resumeId,
				...(posting ? { applicationId: posting.id } : {}),
				newId: pendingRequestId(key),
			});
		} catch {
			toast.add({ type: "error", description: `${t`Couldn't make a copy to work on.`} ${KEPT()}` });
			return;
		}

		try {
			await client.agent.threads.update({ id: threadId, workingResumeId: copyId });
		} catch (error) {
			const moved =
				error instanceof ORPCError &&
				error.code === "CONFLICT" &&
				(await client.agent.threads
					.get({ id: threadId })
					.then(({ thread }) => thread.workingResumeId === copyId)
					.catch(() => false));
			if (!moved) {
				// Refused for good (the resume changed meanwhile): this copy can't be used, so the next try makes another.
				if (error instanceof ORPCError && error.code === "CONFLICT") {
					settleRequestId(key);
					await client.documents.trash({ type: "resume", id: copyId }).catch(() => undefined);
				}
				toast.add({
					type: "error",
					description: `${t`Couldn't move this conversation to a copy.`} ${KEPT()}`,
				});
				return;
			}
		}
		settleRequestId(key);
		useNewDocumentsStore.getState().markNew(copyId);
		void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		await queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });

		await open(copyId);
		if (!(await opened(copyId))) {
			toast.add({ description: t`The copy was made. Open it to accept the edits there.` });
			return;
		}
		// Applied in the copy's own builder, as one undo step with Undo in the toast; its save records the acceptance.
		acceptResumeProposals(proposals);
	} finally {
		inFlight.delete(threadId);
	}
}
