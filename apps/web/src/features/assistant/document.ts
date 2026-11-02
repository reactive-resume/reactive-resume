import type { Passage, Proposal, ProposalApplicationResult, ProposalState } from "@reactive-resume/resume/proposals";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	applyProposals,
	collectLetterPassages,
	collectPassages,
	getProposalState,
	getStateIn,
} from "@reactive-resume/resume/proposals";
import { toast } from "@reactive-resume/ui/components/toast";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useLetterEditorStore } from "@/features/letters/store";
import { useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { getSectionName } from "@/features/resume/editor/check/issues";
import { acceptResumeProposals, proposalResultMessage } from "@/features/resume/editor/proposals/proposals";
import { describeEntry } from "@/features/resume/editor/write/model";

/** The document the assistant works on, as the panel needs it. Resumes and letters each provide one. */
export type AssistantDocument = {
	kind: "resume" | "letter";
	id: string;
	name: string;
	/** Document revision whose authoritative proposal decisions should be read. */
	proposalRevision?: string;
	locked: boolean;
	/** The application it's for, whose posting is shared as context. */
	posting: { id: string; company: string; role: string } | null;
	/**
	 * Edits that use the posting can land here: a letter, or a resume copied for that application. A base resume
	 * other jobs share is copied first (the server refuses tailoring edits to it).
	 */
	jobCopy: boolean;
	/** The application this resume was made for (null for a base resume or a letter). */
	madeFor: string | null;
	/** A proposal's state against the document as it reads now. */
	stateOf: (proposal: Proposal) => ProposalState;
	/** Applies proposals as one undo step, with Undo in the toast. */
	accept: (proposals: readonly Proposal[]) => ProposalApplicationResult;
	/** Where a proposal lands, in the app's language, when its passage is still there. */
	locationOf: (proposal: Pick<Proposal, "before" | "target"> & { location?: string }) => string | undefined;
};

const bullet = (n: number) => t`bullet ${n}`;
const paragraph = (n: number) => t`paragraph ${n}`;

/**
 * Where a proposal lands: the passage it replaces, or the one an addition follows. Once that text is gone (the edit
 * was applied), the entry is still named as the outline names it, with the bullet or paragraph the edit recorded, so
 * one set doesn't call one job by its company and another by its title.
 */
function locate(
	passages: readonly Passage[],
	{ before, target, location }: Pick<Proposal, "before" | "target"> & { location?: string },
) {
	const sameField = passages.filter(
		(passage) =>
			passage.target.sectionId === target.sectionId &&
			passage.target.itemId === target.itemId &&
			passage.target.roleId === target.roleId &&
			passage.target.field === target.field,
	);
	const matches = sameField.filter(
		(passage) => passage.html && (before === passage.html || before.startsWith(passage.html)),
	);
	if (matches.length === 1) return matches[0]?.location;
	const entry = sameField[0];
	if (!entry || matches.length > 1) return undefined;
	// Every passage of a field shares its section and entry; only the last part (its place) differs.
	const where = entry.html ? entry.location.split(" · ").slice(0, -1) : entry.location.split(" · ");
	const place = /(bullet|paragraph) (\d+)$/.exec(location ?? "");
	if (!place) return where.join(" · ") || undefined;
	return [...where, place[1] === "bullet" ? bullet(Number(place[2])) : paragraph(Number(place[2]))].join(" · ");
}

export function useResumeAssistantDocument(): AssistantDocument {
	const resume = useCurrentResume();
	const applicationsOfProposals = useResumeStore((state) => state.proposalApplications);
	const { applicationId } = useSearch({ strict: false });
	const { data: applications } = useQuery(applicationsListQueryOptions());
	// The application it was made for, otherwise the latest one it's linked to (as the server reads it).
	const application = applicationId
		? applications?.find((item) => item.id === applicationId)
		: (applications?.find((item) => item.id === resume.applicationId) ??
			applications?.find((item) => item.resumeId === resume.id));

	return useMemo(() => {
		const passages = collectPassages(resume.data, {
			summary: getSectionName(resume.data, "summary"),
			sectionTitle: (sectionId) => getSectionName(resume.data, sectionId),
			entryTitle: (type, entry) => describeEntry(type as never, entry as never).title,
			bullet,
			paragraph,
		});

		return {
			kind: "resume",
			id: resume.id,
			name: resume.name,
			proposalRevision: resume.updatedAt.toISOString(),
			locked: resume.isLocked,
			posting: application ? { id: application.id, company: application.company, role: application.role } : null,
			// Unknown while applications load: tailoring can't be confirmed for this resume yet.
			jobCopy: applications !== undefined && (!application || application.id === resume.applicationId),
			madeFor: resume.applicationId ?? null,
			stateOf: (proposal) => getProposalState(resume.data, proposal, applicationsOfProposals),
			// Synchronous with the click: the document is checked and changed in the same turn, never after a wait.
			accept: (proposals) =>
				useResumeStore.getState().resume?.id === resume.id
					? acceptResumeProposals(proposals)
					: { applied: [], stale: [] },
			locationOf: (proposal) => locate(passages, proposal),
		};
	}, [
		resume.id,
		resume.name,
		resume.updatedAt,
		resume.isLocked,
		resume.data,
		resume.applicationId,
		applications,
		application,
		applicationsOfProposals,
	]);
}

export function useLetterAssistantDocument(): AssistantDocument | null {
	const letter = useLetterEditorStore((state) => state.letter);
	const applicationsOfProposals = useLetterEditorStore((state) => state.proposalApplications);
	const { applicationId } = useSearch({ strict: false });
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const application = applications?.find((item) => item.id === (applicationId ?? letter?.sourceApplicationId));

	return useMemo(() => {
		if (!letter) return null;
		const passages = collectLetterPassages(letter.content, { body: t`Letter`, bullet, paragraph });

		return {
			kind: "letter",
			id: letter.id,
			name: letter.name,
			proposalRevision: String(letter.revision),
			locked: letter.isLocked,
			posting: application ? { id: application.id, company: application.company, role: application.role } : null,
			jobCopy: true,
			madeFor: null,
			stateOf: (proposal) => getStateIn(letter.content, proposal, applicationsOfProposals),
			accept: (proposals) => {
				const { letter: current, edit, changing, proposalApplications, sessionId } = useLetterEditorStore.getState();
				if (!current || current.id !== letter.id || current.isLocked || changing) return { applied: [], stale: [] };
				const before = current.content;
				let content = before;
				const result = applyProposals(
					proposals,
					() => content,
					(_, value) => {
						content = value;
					},
					proposalApplications,
				);
				if (result.applied.length > 0) edit({ content }, { applied: result.applied });
				if (result.applied.length > 0 || result.stale.length > 0)
					toast.add({
						description: proposalResultMessage(result),
						...(result.applied.length > 0
							? {
									actionProps: {
										children: t`Undo`,
										onClick: () => {
											const latest = useLetterEditorStore.getState();
											if (
												latest.sessionId === sessionId &&
												latest.letter?.id === current.id &&
												latest.letter.content === content &&
												!latest.letter.isLocked &&
												!latest.changing
											)
												latest.edit({ content: before }, { restoreApplications: proposalApplications });
										},
									},
								}
							: {}),
					});
				return result;
			},
			locationOf: (proposal) => locate(passages, proposal),
		};
	}, [letter, application, applicationsOfProposals]);
}
