import type { Proposal, ProposalApplicationResult, ProposalState } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";
import { applyProposals, getProposalState, getStateIn } from "@reactive-resume/resume/proposals";
import { acceptResumeProposals, proposalResultMessage } from "./proposals";
import { getAccountScope } from "@/auth/session";
import { useLetterStore, useResumeStore } from "@/draft";
import { letterAdapter } from "@/draft/adapters";
import { useApplications } from "@/features/applications/queries";
import { dismissToast, showToast } from "@/ui";

/** The document the assistant works on (web: AssistantDocument). Each builder layout owns its draft. */
export type AssistantDocument = {
	kind: "resume" | "letter";
	id: string;
	name: string;
	/** Document revision whose authoritative proposal decisions should be read. */
	proposalRevision?: string;
	locked: boolean;
	/** The application it's for, whose posting is shared as context. */
	posting: { id: string; company: string; role: string } | null;
	/** A proposal's state against the document as it reads now. */
	stateOf: (proposal: Proposal) => ProposalState;
	/** Applies proposals to the draft as one undo step, with Undo in the toast. */
	accept: (proposals: readonly Proposal[]) => ProposalApplicationResult;
	/** Confirm the server has this draft before the model reads it. */
	flush: () => Promise<boolean>;
};

/**
 * The open resume from the draft store, or null until the builder layout (its one owner) has opened `resumeId`. The
 * Assistant lives inside that layout, so it only subscribes. `applicationId` is
 * the application it was opened for; otherwise the one it was made for, then the latest one linked to it.
 */
export function useResumeAssistantDocument(resumeId: string, applicationId?: string): AssistantDocument | null {
	const document = useResumeStore((state) => (state.document?.id === resumeId ? state.document : null));
	const data = useResumeStore((state) => (state.document?.id === resumeId ? (state.data as ResumeData | null) : null));
	const scope = getAccountScope();
	const locked = useResumeStore((state) => state.locked);
	const applicationsOfProposals = useResumeStore((state) => state.proposalApplications);
	const { data: applications } = useApplications();

	return useMemo(() => {
		if (!document || !data) return null;
		const application = applicationId
			? applications?.find((item) => item.id === applicationId)
			: (applications?.find((item) => item.id === document.applicationId) ??
				applications?.find((item) => item.resumeId === document.id));
		return {
			kind: "resume",
			id: document.id,
			name: document.name,
			proposalRevision: document.updatedAt.toISOString(),
			locked,
			posting: application ? { id: application.id, company: application.company, role: application.role } : null,
			stateOf: (proposal) => getProposalState(data, proposal, applicationsOfProposals),
			accept: (proposals) => {
				if (getAccountScope() !== scope || useResumeStore.getState().document?.id !== resumeId)
					return { applied: [], stale: [] };
				return acceptResumeProposals(proposals);
			},
			flush: async () => {
				if (!scope || getAccountScope() !== scope || useResumeStore.getState().document?.id !== resumeId) return false;
				await useResumeStore.getState().flush();
				const current = useResumeStore.getState();
				return (
					getAccountScope() === scope &&
					current.document?.id === resumeId &&
					!current.locked &&
					!current.conflict &&
					(current.status === "saved" || current.status === "idle")
				);
			},
		};
	}, [document, data, locked, applications, applicationId, resumeId, scope, applicationsOfProposals]);
}

/** Subscribes to the letter layout's draft; proposals edit the body using the shared letter contract. */
export function useLetterAssistantDocument(letterId: string, applicationId?: string): AssistantDocument | null {
	const document = useLetterStore((state) => (state.document?.id === letterId ? state.document : null));
	const locked = useLetterStore((state) => state.locked);
	const applicationsOfProposals = useLetterStore((state) => state.proposalApplications);
	const { data: applications } = useApplications();
	const scope = getAccountScope();

	return useMemo(() => {
		if (!document) return null;
		const application = applications?.find((item) => item.id === (applicationId ?? document.sourceApplicationId));
		const isCurrent = () =>
			scope !== null && getAccountScope() === scope && useLetterStore.getState().document?.id === letterId;
		return {
			kind: "letter",
			id: document.id,
			name: document.name,
			proposalRevision: String(document.revision),
			locked,
			posting: application ? { id: application.id, company: application.company, role: application.role } : null,
			stateOf: (proposal) => getStateIn(document.content, proposal, applicationsOfProposals),
			accept: (proposals) => {
				let result: ProposalApplicationResult = { applied: [], stale: [] };
				const proposalIds: string[] = [];
				if (!isCurrent() || useLetterStore.getState().locked) return result;
				useLetterStore.getState().update(
					(draft) => {
						result = applyProposals(
							proposals,
							() => draft.content,
							(_, value) => {
								draft.content = value;
							},
							useLetterStore.getState().proposalApplications,
						);
						proposalIds.push(...result.applied.map((proposal) => proposal.id));
					},
					{ newStep: true, proposalIds },
				);
				const accepted = useLetterStore.getState().data;
				if (!accepted || result.applied.length === 0) {
					if (result.stale.length > 0) showToast({ message: proposalResultMessage(result) });
					return result;
				}
				let eligible = true;
				const toastId = showToast({
					message: proposalResultMessage(result),
					action: {
						label: t`Undo`,
						onPress: () => {
							const current = useLetterStore.getState();
							if (
								eligible &&
								isCurrent() &&
								current.document &&
								!current.locked &&
								letterAdapter.matches(current.document, accepted)
							)
								current.undo();
							else showToast({ message: t`Use the builder's Undo to undo earlier changes.` });
						},
					},
				});
				const unsubscribe = useLetterStore.subscribe((current) => {
					// Saves replace the whole letter; compare authored fields, ignoring revision and server metadata.
					if (isCurrent() && current.document && letterAdapter.matches(current.document, accepted)) return;
					eligible = false;
					dismissToast(toastId);
					unsubscribe();
				});
				// Action toasts last up to 12 seconds with a screen reader; eligibility ends with monitoring.
				setTimeout(() => {
					eligible = false;
					unsubscribe();
				}, 12000);
				return result;
			},
			flush: async () => {
				if (!isCurrent()) return false;
				await useLetterStore.getState().flush();
				const current = useLetterStore.getState();
				return (
					isCurrent() &&
					!current.locked &&
					!current.conflict &&
					(current.status === "saved" || current.status === "idle")
				);
			},
		};
	}, [document, locked, applications, applicationId, letterId, scope, applicationsOfProposals]);
}
