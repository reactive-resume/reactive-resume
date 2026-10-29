import { t } from "@lingui/core/macro";
import { ChatCircleDotsIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/integrations/orpc/client";
import { cn } from "@/utils/style";
import { POFeedbackSentBadge } from "./po-feedback-sent-badge";

type Stats = {
	totalStudents: number;
	totalResumes: number;
	approvedResumes: number;
	evaluatedResumes: number;
	averageScore: number | null;
	[key: string]: unknown;
};

type Props = {
	sectionId: string;
	sectionName: string;
	tenantId: string;
	stats: Stats;
	poSubmittedResumes: Array<{ id: string; studentId: string }>;
	sectionStudents: Array<{
		engLabsId: string;
		resumes: Array<{ id: string; reviewStatus?: string | null; studentId?: string }>;
	}>;
	onOpenReviewDialog: () => void;
	isPending: boolean;
};

export function POSectionCardActions({
	sectionId,
	sectionName,
	tenantId,
	stats,
	poSubmittedResumes,
	sectionStudents,
	onOpenReviewDialog,
	isPending,
}: Props) {
	const queryClient = useQueryClient();

	const { data: reviews } = useQuery(
		orpc.resume.dashboard.getPoSectionReviews.queryOptions({
			input: { sectionId, tenantId },
		}),
	);

	const bulkUpdateMutation = useMutation({
		...orpc.resume.dashboard.bulkUpdateResumes.mutationOptions(),
		onSuccess: () => queryClient.invalidateQueries(),
	});

	const hasSentFeedback = (reviews?.length ?? 0) > 0;

	// Resumes waiting for faculty to resubmit after PO feedback (FINALIZED_BY_FACULTY with prior feedback)
	const awaitingResubmission = hasSentFeedback && poSubmittedResumes.length === 0;

	const poVerifiedResumes = (stats.poVerifiedResumes as number | undefined) ?? 0;
	const passedFaculty = (stats.passedFaculty as number | undefined) ?? 0;

	// Approve against what students actually handed in. The denominator used to be every resume
	// in the section, drafts included, so a section with ten students who never submitted could
	// never be approved however well the rest of the cohort did.
	const submitted = (stats.submittedResumes as number | undefined) ?? 0;
	const notSubmitted = Math.max(0, stats.totalResumes - submitted);
	const decided = poVerifiedResumes + stats.approvedResumes;
	const allApproved = submitted > 0 && stats.approvedResumes >= submitted;
	const readyToApprove = submitted > 0 && decided >= submitted && !allApproved;

	return (
		<div className="space-y-2">
			{/* Feedback sent badge — shown when PO has previously sent feedback */}
			{hasSentFeedback && (
				<POFeedbackSentBadge
					sectionId={sectionId}
					sectionName={sectionName}
					tenantId={tenantId}
					resumes={poSubmittedResumes}
					onSuccess={() => queryClient.invalidateQueries()}
				/>
			)}

			{/* Send feedback button — only when resumes are actively in PO hands */}
			{poSubmittedResumes.length > 0 && (
				<button
					type="button"
					onClick={onOpenReviewDialog}
					className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 py-2.5 font-bold text-amber-700 text-sm shadow-sm transition-all hover:bg-amber-100 active:scale-[0.98]"
				>
					<ChatCircleDotsIcon weight="duotone" className="size-4" />
					{t`Review & Send Feedback`}
					<span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px]">{poSubmittedResumes.length}</span>
				</button>
			)}

			{notSubmitted > 0 && (
				<p className="text-center text-[11px] text-muted-foreground">
					{t`${notSubmitted} of ${stats.totalStudents} students have not submitted yet`}
				</p>
			)}

			{/* Approve / status button — hidden when waiting for faculty resubmission after feedback */}
			{!awaitingResubmission && (
				<button
					type="button"
					disabled={!readyToApprove || isPending}
					onClick={() => {
						const poPendingList = sectionStudents.flatMap((s) =>
							s.resumes
								.filter(
									(r) =>
										r.reviewStatus === "PO_VERIFIED" ||
										r.reviewStatus === "SUBMITTED_TO_PO" ||
										r.reviewStatus === "RESUBMITTED_TO_PO",
								)
								.map((r) => ({ id: r.id, studentId: s.engLabsId })),
						);
						bulkUpdateMutation.mutate({
							resumes: poPendingList,
							tenantId,
							status: "APPROVED",
						});
					}}
					className={cn(
						"flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-sm shadow-sm transition-all active:scale-[0.98]",
						readyToApprove
							? "bg-primary text-white hover:bg-primary/90"
							: allApproved
								? "cursor-default border border-emerald-100 bg-emerald-50 text-emerald-600"
								: passedFaculty === submitted && submitted > 0
									? "cursor-help border border-amber-200 bg-amber-50 text-amber-600"
									: "cursor-not-allowed border border-border bg-muted/50 text-muted-foreground",
					)}
				>
					{allApproved ? (
						<>
							<CheckCircleIcon weight="fill" className="size-4" />
							{t`Approved for Placement`}
						</>
					) : readyToApprove ? (
						t`Approve for Placement`
					) : submitted === 0 ? (
						t`No submissions yet`
					) : (
						t`Verify All (${poVerifiedResumes} / ${submitted}) First`
					)}
				</button>
			)}
		</div>
	);
}
