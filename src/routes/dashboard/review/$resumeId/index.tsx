import { t } from "@lingui/core/macro";
import {
	ArrowLeftIcon,
	CaretLeftIcon,
	CaretRightIcon,
	ChatDotsIcon,
	CheckCircleIcon,
	ClockCounterClockwiseIcon,
	DownloadSimpleIcon,
	ExamIcon,
	GitDiffIcon,
	ListChecksIcon,
	PlusMinusIcon,
	ShootingStarIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
// Default import: fast-json-patch is CommonJS, and a named import breaks server rendering of this page.
import jsonpatch from "fast-json-patch";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { toast } from "sonner";
import { useResizeObserver } from "usehooks-ts";
import { z } from "zod";
import { ResumePreview } from "@/components/resume/preview";
import {
	anchoredComments,
	anchorFromRange,
	anchorLabel,
	SEVERITY_BADGE,
	scrollToAnchor,
	severityEdge,
	severityLabel,
	useChangeHighlights,
	useReviewHighlights,
} from "@/components/resume/review-anchors";
import { useResumeStore } from "@/components/resume/store/resume";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/integrations/orpc/client";
import { anchorText, type CommentAnchor, changedAnchors } from "@/schema/resume/comment-anchor";
import type { ResumeData } from "@/schema/resume/data";
import { getOrganisationUnits } from "@/utils/sso-context";
import { cn } from "@/utils/style";
import { getStatusBadgeClass } from "../../-components/score-helpers";
import { StudentTimeline } from "../../-components/student-timeline";
import { useResumeDownload } from "../../-components/use-resume-download";
import { CommentComposer } from "./-comment-composer";

const searchSchema = z.object({
	engLabsStudentId: z.string().catch(""),
	tenantId: z.string().catch("default"),
	packageId: z.string().optional(),
	unitType: z.string().optional(),
	unitId: z.string().optional(),
	sectionId: z.string().optional(),
	scope: z.enum(["faculty", "po", "admin"]).optional().default("faculty"),
});

export const Route = createFileRoute("/dashboard/review/$resumeId/")({
	component: ReviewPage,
	validateSearch: zodValidator(searchSchema),
	beforeLoad: async ({ context }) => {
		if (!context.session) throw redirect({ to: "/auth/login", replace: true });
		return { session: context.session };
	},
});

type ReviewTab = "comments" | "evaluate" | "changes" | "timeline";

const PENDING_ANCHOR = "pending";

function ReviewPage() {
	const { resumeId } = Route.useParams();
	const { engLabsStudentId, tenantId, packageId, unitType, unitId, sectionId, scope } = Route.useSearch();

	const [activeTab, setActiveTab] = useState<ReviewTab>("comments");
	const [showHighlights, setShowHighlights] = useState(true);
	const [showDiff, setShowDiff] = useState(false);
	const [replyTo, setReplyTo] = useState<string | null>(null);
	const [anchor, setAnchor] = useState<CommentAnchor | null>(null);
	const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
	const [compareId, setCompareId] = useState<string | null>(null);
	// Prev/Next keep this page mounted, so what was aimed at one student's resume is dropped when the resume changes.
	const [shownResumeId, setShownResumeId] = useState(resumeId);
	if (shownResumeId !== resumeId) {
		setShownResumeId(resumeId);
		setReplyTo(null);
		setAnchor(null);
		setActiveCommentId(null);
		setCompareId(null);
	}
	const commentInputRef = useRef<HTMLTextAreaElement>(null);
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	// Sequential navigation logic
	const { data: dashboard } = useQuery(
		orpc.resume.dashboard.sections.queryOptions({
			input: {
				sectionIds: (getOrganisationUnits() ?? []) as string[],
				tenantId: tenantId!,
				scope: (scope === "po" || scope === "admin" ? "po" : "faculty") as "faculty" | "po",
				activeUnitId: unitId,
			},
		}),
	);

	const navigationList = useMemo(() => {
		if (!dashboard?.students) return [];
		return dashboard.students.flatMap((student) =>
			student.resumes.map((resume) => ({
				...resume,
				engLabsStudentId: student.engLabsId,
			})),
		);
	}, [dashboard?.students]);

	// The student this resume belongs to, for the download's filename. The dashboard query is already
	// loaded for Prev/Next, so this costs nothing extra; a download before it settles falls back to
	// the resume's own name.
	const student = dashboard?.students?.find((s) => s.engLabsId === engLabsStudentId);

	const currentIndex = navigationList.findIndex((r) => r.id === resumeId);
	const prevResume = currentIndex > 0 ? navigationList[currentIndex - 1] : null;
	const nextResume =
		currentIndex >= 0 && currentIndex < navigationList.length - 1 ? navigationList[currentIndex + 1] : null;

	const handleNavigate = (target: (typeof navigationList)[0]) => {
		navigate({
			to: "/dashboard/review/$resumeId",
			params: { resumeId: target.id },
			search: {
				engLabsStudentId: target.engLabsStudentId,
				tenantId,
				packageId,
				unitType: unitType as any,
				unitId,
				sectionId,
				scope,
			},
		});
	};

	const previewContainerRef = useRef<HTMLDivElement>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	useResizeObserver({
		ref: previewContainerRef as RefObject<HTMLDivElement>,
		onResize: ({ width }) => {
			if (width) setContainerWidth(width);
		},
	});
	const PAGE_NATURAL_WIDTH = 794;
	const scale = containerWidth > 0 ? Math.min(1, containerWidth / PAGE_NATURAL_WIDTH) : 1;

	const reviewQueryKey = orpc.resume.dashboard.reviewResume.queryOptions({ input: { resumeId } });

	const { data, isLoading } = useQuery(reviewQueryKey);

	const initialize = useResumeStore((state) => state.initialize);

	// Load the student's resume into the preview store (read-only — we never call updateResumeData)
	useEffect(() => {
		if (!data?.resume) return;
		const r = data.resume;
		initialize({
			id: r.id,
			name: r.name,
			slug: r.slug,
			tags: r.tags,
			isLocked: r.isLocked,
			data: r.data,
			reviewStatus: r.reviewStatus as any,
		});
		return () => initialize(null);
	}, [data?.resume, initialize]);

	const addCommentMutation = useMutation({
		...orpc.resume.comments.create.mutationOptions(),
		onSuccess: (comment) => {
			setReplyTo(null);
			setAnchor(null);
			if (comment.anchor) setActiveCommentId(comment.id);
			queryClient.invalidateQueries(reviewQueryKey);
		},
	});

	const updateCommentStatusMutation = useMutation({
		...orpc.resume.comments.updateStatus.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries(reviewQueryKey);
		},
	});

	const addCommentsMutation = useMutation({
		...orpc.resume.comments.createMany.mutationOptions(),
		onSuccess: () => {
			setReplyTo(null);
			setAnchor(null);
			queryClient.invalidateQueries(reviewQueryKey);
		},
	});

	const deleteCommentMutation = useMutation({
		...orpc.resume.comments.delete.mutationOptions(),
		onSuccess: () => {
			setActiveCommentId(null);
			queryClient.invalidateQueries(reviewQueryKey);
		},
		onError: (error) => {
			toast.error(error instanceof Error ? error.message : t`Could not delete that comment.`);
		},
	});

	const confirm = useConfirm();
	const { download, isPending: isDownloading } = useResumeDownload();

	/**
	 * Whether a comment is the signed-in reviewer's own. `author_id` is an eng-labs id, which the
	 * browser has no way to derive from the session, so the server sends the viewer's alongside the
	 * comments. Unknown means no Delete button — never a guess.
	 */
	const isMine = (authorId: string) => !!data?.viewerEngLabsId && authorId === data.viewerEngLabsId;

	/**
	 * Deleting feedback is not undoable and the student may already have read it, so the dialog says
	 * what actually disappears — including the replies, which go with the thread.
	 */
	const removeComment = async (comment: { id: string; content: string }, replyCount: number) => {
		const ok = await confirm(t`Delete this comment?`, {
			description:
				replyCount > 0
					? t`“${comment.content}” and the ${replyCount} replies under it will be removed from the student's feedback for good.`
					: t`“${comment.content}” will be removed from the student's feedback for good.`,
			confirmText: t`Delete`,
		});
		if (ok) deleteCommentMutation.mutate({ id: comment.id });
	};

	const updateResumeStatusMutation = useMutation({
		...orpc.resume.dashboard.updateStatus.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries(reviewQueryKey);
		},
		// The server refuses a verdict when the Placement Officer has taken the resume on, or when
		// someone else reviewed it while this page was open. Both arrive as CONFLICT and carry a
		// message worth reading, so show it and refetch — silently discarding it would leave the
		// reviewer believing a verdict was recorded.
		onError: (error) => {
			const message = error instanceof Error ? error.message : t`Could not save that verdict.`;
			toast.error(message);
			queryClient.invalidateQueries(reviewQueryKey);
		},
	});

	const toggleLockMutation = useMutation({
		...orpc.resume.dashboard.toggleResumeLock.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries(reviewQueryKey);
		},
	});

	// Anchored comments (plus the selection being commented on) are highlighted on the resume.
	const highlightTargets = useMemo(() => {
		const anchored = anchoredComments(data?.comments ?? []);
		return anchor ? [...anchored, { id: PENDING_ANCHOR, anchor }] : anchored;
	}, [data?.comments, anchor]);

	const anchorStatuses = useReviewHighlights(highlightTargets, anchor ? PENDING_ANCHOR : activeCommentId, (id) => {
		if (id === PENDING_ANCHOR) return;
		setActiveCommentId(id);
		setActiveTab("comments");
	});

	useEffect(() => {
		if (activeCommentId) document.getElementById(`comment-${activeCommentId}`)?.scrollIntoView({ block: "nearest" });
	}, [activeCommentId]);

	useHotkeys("escape", () => setAnchor(null));

	// "What changed since the last review": compared with the resume as last reviewed (comment, evaluation or verdict).
	const copies = useMemo(() => (data ? reviewCopies(data.evaluations, data.history, data.comments) : []), [data]);
	// A copy identical to the resume as it is now, kept with this round's first comment, would hide every change.
	const baseline = useMemo(() => {
		if (!data) return null;
		const seen = data.comments.filter((c) => c.snapshot && jsonpatch.compare(c.snapshot, data.resume.data).length > 0);
		return reviewCopies(data.evaluations, data.history, seen)[0] ?? null;
	}, [data]);
	const changes = useMemo(
		() => (baseline && data ? changedAnchors(baseline.data, data.resume.data as ResumeData) : []),
		[baseline, data],
	);
	useChangeHighlights(activeTab === "changes" && showHighlights ? changes : []);

	// Selecting text on the resume attaches it to the comment box.
	const captureSelection = () => {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
		const next = anchorFromRange(selection.getRangeAt(0));
		if (!next) return;
		// The pending highlight now marks the text. Dropping the native selection makes sure typing
		// lands in the comment box even if it already had focus.
		selection.removeAllRanges();
		setAnchor(next);
		setReplyTo(null);
		setActiveTab("comments");
		commentInputRef.current?.focus();
	};

	if (isLoading) {
		return (
			<div className="flex h-full flex-col gap-4 p-6 md:p-8">
				<Skeleton className="h-10 w-64 rounded-xl" />
				<div className="flex flex-1 gap-6">
					<Skeleton className="flex-1 rounded-2xl" />
					<Skeleton className="w-[420px] rounded-2xl" />
				</div>
			</div>
		);
	}

	if (!data) {
		return (
			<div className="flex h-96 items-center justify-center">
				<p className="text-muted-foreground">{t`Resume not found`}</p>
			</div>
		);
	}

	const { resume, comments, evaluations, history } = data;

	// Standard feedback already sent on this resume, so the composer can mark it instead of
	// letting a reviewer send the same line again on a later round.
	const sentContents = new Set(comments.map((c) => c.content));
	const latestEval = evaluations[0];
	const status =
		resume.reviewStatus === "DRAFT"
			? { bg: "bg-muted", text: "text-muted-foreground", label: "Draft" }
			: getStatusBadgeClass(resume.reviewStatus ?? "");

	const tabs: { id: ReviewTab; icon: React.ReactNode; label: string; count?: number }[] = [
		{
			id: "comments",
			icon: <ChatDotsIcon weight="duotone" className="size-4" />,
			label: t`Comments`,
			count: comments.length,
		},
		{
			id: "evaluate",
			icon: <ExamIcon weight="duotone" className="size-4" />,
			label: t`Evaluate`,
			count: evaluations.length,
		},
		{
			id: "changes",
			icon: <ShootingStarIcon weight="duotone" className="size-4" />,
			label: t`Changes`,
		},
		{
			id: "timeline",
			icon: <ClockCounterClockwiseIcon weight="duotone" className="size-4" />,
			label: t`Timeline`,
			count: history.length,
		},
	];

	return (
		<div className="relative flex h-full flex-col overflow-hidden">
			{/* ── Top bar ── */}
			<div className="flex shrink-0 items-center gap-4 border-border border-b bg-card px-6 py-3">
				<Link
					to={scope === "po" || scope === "admin" ? "/dashboard/placement-officer" : "/dashboard/faculty"}
					search={
						sectionId
							? { tab: "sections", sectionId, packageId, unitType, unitId }
							: { tab: "students", packageId, unitType, unitId }
					}
					className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-all hover:bg-border"
				>
					<ArrowLeftIcon weight="bold" className="size-4" />
				</Link>
				<div className="min-w-0 flex-1">
					<h1 className="truncate font-bold text-foreground">{resume.name}</h1>
					<p className="text-muted-foreground text-xs">Updated {new Date(resume.updatedAt).toLocaleDateString()}</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<div className="mr-2 flex items-center gap-1 border-border border-r pr-4">
						<button
							type="button"
							disabled={!prevResume}
							onClick={() => prevResume && handleNavigate(prevResume)}
							className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-all hover:bg-muted disabled:opacity-30"
						>
							<CaretLeftIcon weight="bold" className="size-4" />
							<span className="font-semibold text-xs">Prev</span>
						</button>
						<button
							type="button"
							disabled={!nextResume}
							onClick={() => nextResume && handleNavigate(nextResume)}
							className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-all hover:bg-muted disabled:opacity-30"
						>
							<span className="font-semibold text-xs">Next</span>
							<CaretRightIcon weight="bold" className="size-4" />
						</button>
					</div>
					<button
						type="button"
						disabled={isDownloading}
						onClick={() => download(resume.id, student?.rollNumber, student?.name ?? resume.data.basics.name)}
						title={t`Download this resume as a PDF`}
						className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1.5 font-semibold text-muted-foreground text-xs transition-all hover:bg-border disabled:opacity-50"
					>
						<DownloadSimpleIcon weight="duotone" className="size-3.5" />
						{isDownloading ? t`Preparing…` : t`Download`}
					</button>
					{!!baseline && (
						<button
							type="button"
							onClick={() => setShowDiff(true)}
							className="flex items-center gap-1.5 rounded-xl bg-primary/5 px-3 py-1.5 font-semibold text-primary text-xs transition-all hover:bg-primary/10"
						>
							<GitDiffIcon weight="duotone" className="size-3.5" />
							Before &amp; After
						</button>
					)}
					{resume.isSubmitted && !latestEval && (
						<span className="rounded-full bg-primary/5 px-3 py-1 font-semibold text-primary text-xs">
							Pending Review
						</span>
					)}
					{latestEval && (
						<span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-700 text-xs">
							Score: {latestEval.overallScore?.toFixed(1)}/5
						</span>
					)}
				</div>
			</div>

			{/* Comparison State */}
			<ComparisonOverlay baseline={baseline} currentData={resume.data} onTabChange={setActiveTab} />

			{/* Revision Diff Overlay */}
			{showDiff && !!baseline && (
				<RevisionDiffOverlay
					snapshot={baseline.data}
					currentData={resume.data}
					evaluatedAt={baseline.at}
					onClose={() => setShowDiff(false)}
				/>
			)}

			{/* ── Body ── */}
			<div className="flex flex-1 overflow-hidden">
				{/* Left: Resume preview */}
				<div className="flex w-[55%] flex-col border-border border-r bg-muted">
					{/* Compact stats bar */}
					<div className="flex shrink-0 items-center gap-6 border-border border-b bg-card px-5 py-2.5 text-muted-foreground text-sm">
						<p>
							<span className="font-semibold text-foreground tabular-nums">{comments.length}</span> {t`comments`}
						</p>
						<p>
							<span className="font-semibold text-foreground tabular-nums">{evaluations.length}</span> {t`evaluations`}
						</p>
						<p>
							{latestEval ? (
								<>
									<span className="font-semibold text-foreground tabular-nums">
										{latestEval.overallScore?.toFixed(1)}/5
									</span>{" "}
									{t`latest score`}
								</>
							) : (
								t`No score yet`
							)}
						</p>
					</div>

					{/* Resume preview — scrollable, scaled to fit container width */}
					<div
						ref={previewContainerRef}
						onMouseUp={captureSelection}
						onKeyUp={captureSelection}
						className="flex-1 overflow-y-auto overflow-x-hidden bg-border py-6"
					>
						<div
							style={{
								width: PAGE_NATURAL_WIDTH,
								transform: `scale(${scale})`,
								transformOrigin: "top center",
								marginLeft: containerWidth > 0 ? (containerWidth - PAGE_NATURAL_WIDTH) / 2 : 0,
							}}
						>
							<ResumePreview className="flex flex-col items-center space-y-4" pageClassName="shadow-xl rounded-sm" />
						</div>
					</div>
				</div>

				{/* Right: Review panel */}
				<div className="flex w-[45%] flex-col overflow-hidden bg-card">
					{/* Panel tabs */}
					<div className="flex shrink-0 gap-0.5 border-border border-b bg-muted/50 px-4 pt-3">
						{tabs.map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setActiveTab(tab.id)}
								className={cn(
									"flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 font-semibold text-sm transition-all",
									activeTab === tab.id
										? "bg-card text-primary shadow-sm"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								{tab.icon}
								{tab.label}
								{tab.count !== undefined && tab.count > 0 && (
									<span
										className={cn(
											"ml-0.5 rounded-full px-1.5 font-bold text-[10px]",
											activeTab === tab.id ? "bg-primary/10 text-primary" : "bg-border text-muted-foreground",
										)}
									>
										{tab.count}
									</span>
								)}
							</button>
						))}
					</div>

					{/* Overall Status & Actions */}
					<div className="border-border border-b bg-muted/50 p-5">
						<div className="flex items-center justify-between gap-4">
							<div>
								<p className="mb-1 font-medium text-muted-foreground text-xs">{t`Review status`}</p>
								<div className="flex items-center gap-2">
									<span className={cn("rounded-full px-2.5 py-0.5 font-semibold text-xs", status.bg, status.text)}>
										{status.label}
									</span>
									{resume.reviewStatus === "FINALIZED_BY_FACULTY" && (
										<span className="flex items-center gap-1 text-[10px] text-muted-foreground italic">
											<ClockCounterClockwiseIcon className="size-3" />
											{t`Pending PO Review`}
										</span>
									)}
								</div>
							</div>

							<div className="flex items-center gap-2">
								{/* Manual Lock/Unlock (Visible to both Faculty/PO) */}
								<button
									onClick={() => toggleLockMutation.mutate({ resumeId, isLocked: !resume.isLocked })}
									disabled={toggleLockMutation.isPending}
									className={cn(
										"flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-bold text-xs shadow-sm transition-all",
										resume.isLocked
											? "bg-amber-100 text-amber-700 hover:bg-amber-200"
											: "bg-muted text-foreground hover:bg-border",
									)}
								>
									{resume.isLocked ? (
										<>
											<ClockCounterClockwiseIcon className="size-3.5" />
											{t`Unlock Resume`}
										</>
									) : (
										<>
											<CheckCircleIcon className="size-3.5" />
											{t`Lock Resume`}
										</>
									)}
								</button>

								<div className="mx-1 h-4 w-px bg-border" />

								{/* Faculty Actions */}
								{(resume.reviewStatus === "SUBMITTED_TO_FACULTY" ||
									resume.reviewStatus === "FACULTY_REVISION_REQUESTED") && (
									<>
										<button
											onClick={() =>
												updateResumeStatusMutation.mutate({
													resumeId,
													expectedStatus: resume.reviewStatus ?? undefined,
													studentId: engLabsStudentId,
													tenantId: tenantId!,
													status: "FACULTY_REVISION_REQUESTED",
												})
											}
											disabled={updateResumeStatusMutation.isPending}
											className="rounded-xl border border-border bg-card px-3 py-1.5 font-bold text-muted-foreground text-xs transition-all hover:bg-muted/50 disabled:opacity-50"
										>
											{t`Request Revision`}
										</button>
										<button
											onClick={() =>
												updateResumeStatusMutation.mutate({
													resumeId,
													expectedStatus: resume.reviewStatus ?? undefined,
													studentId: engLabsStudentId,
													tenantId: tenantId!,
													status: "FACULTY_VERIFIED",
												})
											}
											disabled={updateResumeStatusMutation.isPending}
											className="rounded-xl bg-emerald-600 px-3 py-1.5 font-bold text-white text-xs shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50"
										>
											{t`Verify Individual`}
										</button>
									</>
								)}

								{/* PO Actions — PO scope only; faculty sees the status badge but no action buttons.
								    SUBMITTED_TO_FACULTY is included because the PO now sees student submissions
								    in their own inbox: without it they could open one and find nothing to do. */}
								{scope === "po" &&
									(resume.reviewStatus === "SUBMITTED_TO_FACULTY" ||
										resume.reviewStatus === "SUBMITTED_TO_PO" ||
										resume.reviewStatus === "FINALIZED_BY_FACULTY" ||
										resume.reviewStatus === "RESUBMITTED_TO_PO" ||
										resume.reviewStatus === "PO_REVISION_REQUESTED" ||
										resume.reviewStatus === "APPROVED") && (
										<>
											<button
												onClick={() =>
													updateResumeStatusMutation.mutate({
														resumeId,
														expectedStatus: resume.reviewStatus ?? undefined,
														studentId: engLabsStudentId,
														tenantId: tenantId!,
														status: "PO_REVISION_REQUESTED",
													})
												}
												disabled={updateResumeStatusMutation.isPending}
												className="rounded-xl border border-rose-200 bg-card px-3 py-1.5 font-bold text-rose-600 text-xs transition-all hover:bg-rose-50 disabled:opacity-50"
											>
												{t`PO: Request Revision`}
											</button>
											{resume.reviewStatus !== "APPROVED" && (
												<button
													onClick={() =>
														updateResumeStatusMutation.mutate({
															resumeId,
															expectedStatus: resume.reviewStatus ?? undefined,
															studentId: engLabsStudentId,
															tenantId: tenantId!,
															status: "APPROVED",
														})
													}
													disabled={updateResumeStatusMutation.isPending}
													className="rounded-xl bg-teal-600 px-3 py-1.5 font-bold text-white text-xs shadow-sm transition-all hover:bg-teal-700 disabled:opacity-50"
												>
													{t`Final Approve`}
												</button>
											)}
										</>
									)}
							</div>
						</div>
					</div>

					{/* Panel content */}
					<div className="flex-1 overflow-y-auto p-5">
						{/* ── Comments ── */}
						{activeTab === "comments" && (
							<div className="space-y-4">
								<CommentComposer
									key={resumeId}
									resumeData={resume.data as ResumeData}
									anchor={replyTo ? null : anchor}
									onClearAnchor={() => setAnchor(null)}
									replyTo={replyTo}
									onCancelReply={() => setReplyTo(null)}
									inputRef={commentInputRef}
									sentContents={sentContents}
									isPending={addCommentMutation.isPending || addCommentsMutation.isPending}
									onSubmit={(input) =>
										addCommentMutation.mutateAsync({
											resumeId,
											studentId: engLabsStudentId,
											tenantId,
											parentId: replyTo ?? undefined,
											anchor: replyTo ? undefined : (anchor ?? undefined),
											...input,
										})
									}
									onSubmitMany={(comments) =>
										addCommentsMutation.mutateAsync({
											resumeId,
											studentId: engLabsStudentId,
											tenantId,
											comments,
										})
									}
								/>

								{comments.length === 0 ? (
									<div className="rounded-2xl bg-muted/50 py-10 text-center">
										<ChatDotsIcon weight="duotone" className="mx-auto mb-2 size-8 text-muted-foreground" />
										<p className="text-muted-foreground text-sm">{t`No comments yet — add your feedback above`}</p>
									</div>
								) : (
									<div className="space-y-4">
										{comments
											.filter((c) => !c.parentId)
											.reverse()
											.map((c) => {
												const replies = comments.filter((r) => r.parentId === c.id);
												const anchorStatus = anchorStatuses[c.id];
												return (
													<div key={c.id} id={`comment-${c.id}`} className="space-y-2">
														<div
															className={cn(
																"rounded-2xl border p-4 shadow-sm transition-all",
																c.status === "RESOLVED"
																	? "border-emerald-100 bg-emerald-50/20"
																	: "border-border bg-card",
																activeCommentId === c.id && "ring-2 ring-amber-400",
															)}
														>
															{c.anchor && (
																<button
																	type="button"
																	onClick={() =>
																		activeCommentId === c.id && c.anchor
																			? scrollToAnchor(c.anchor)
																			: setActiveCommentId(c.id)
																	}
																	className={cn(
																		"mb-2 block w-full rounded-lg border-l-4 bg-amber-500/10 px-3 py-1.5 text-start hover:bg-amber-500/20",
																		severityEdge(c.severity),
																	)}
																>
																	<span className="flex flex-wrap items-center gap-1.5 font-semibold text-[11px] text-muted-foreground">
																		{anchorLabel(c.anchor, resume.data)}
																		{anchorStatus === "changed" && (
																			<span className="rounded bg-primary/10 px-1.5 text-primary">{t`Text changed`}</span>
																		)}
																		{anchorStatus === "missing" && (
																			<span className="rounded bg-border px-1.5 text-muted-foreground">{t`Removed from resume`}</span>
																		)}
																	</span>
																	<span
																		className={cn(
																			"line-clamp-2 text-foreground text-xs",
																			anchorStatus && anchorStatus !== "ok" && "line-through opacity-70",
																		)}
																	>
																		{c.anchor.quote ? `“${c.anchor.quote.exact}”` : t`Whole section`}
																	</span>
																</button>
															)}
															{c.severity && (
																<span
																	className={cn(
																		"mb-1.5 inline-block rounded-md px-1.5 py-0.5 font-semibold text-[10px]",
																		SEVERITY_BADGE[c.severity],
																	)}
																>
																	{t`${severityLabel(c.severity)} severity`}
																</span>
															)}
															<p
																className={cn(
																	"text-foreground text-sm leading-relaxed",
																	c.status === "RESOLVED" && "text-muted-foreground line-through",
																)}
															>
																{c.content}
															</p>
															{c.suggestion && c.anchor?.quote && (
																<p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs">
																	<span className="font-semibold text-emerald-700">{t`Suggested rewrite`} </span>
																	<del className="text-muted-foreground">{c.anchor.quote.exact}</del>{" "}
																	<ins className="text-foreground no-underline">{c.suggestion}</ins>
																</p>
															)}
															{compareId === c.id && c.anchor && (
																<BeforeAfter
																	anchor={c.anchor}
																	before={copies.find((copy) => copy.at <= new Date(c.createdAt))?.data}
																	now={resume.data as ResumeData}
																/>
															)}
															<div className="mt-3 flex items-center justify-between">
																<div className="flex items-center gap-3">
																	<p className="text-[10px] text-muted-foreground">
																		{new Date(c.createdAt).toLocaleDateString()}
																	</p>
																	<button
																		type="button"
																		onClick={() => {
																			setReplyTo(c.id);
																			// Focus textarea
																			window.scrollTo({ top: 0, behavior: "smooth" });
																		}}
																		className="font-bold text-[10px] text-primary hover:underline"
																	>
																		{t`Reply`}
																	</button>
																	{c.anchor && (
																		<button
																			type="button"
																			aria-expanded={compareId === c.id}
																			onClick={() => setCompareId(compareId === c.id ? null : c.id)}
																			className="flex items-center gap-1 font-bold text-[10px] text-primary hover:underline"
																		>
																			<GitDiffIcon className="size-3" />
																			{t`Before / after`}
																		</button>
																	)}
																	{/* Only on your own feedback: a Placement Officer outranks a faculty member on a
																	    verdict, not on whether their written feedback ever happened. */}
																	{isMine(c.authorId) && (
																		<button
																			type="button"
																			disabled={deleteCommentMutation.isPending}
																			onClick={() => void removeComment(c, replies.length)}
																			className="flex items-center gap-1 font-bold text-[10px] text-muted-foreground hover:text-rose-600 hover:underline disabled:opacity-40"
																		>
																			<TrashIcon className="size-3" />
																			{t`Delete`}
																		</button>
																	)}
																</div>
																<div className="flex items-center gap-2">
																	{c.status === "OPEN" && (
																		<button
																			type="button"
																			onClick={() =>
																				updateCommentStatusMutation.mutate({ id: c.id, status: "ADDRESSED" })
																			}
																			className="rounded-lg bg-card px-2 py-1 font-semibold text-[10px] text-amber-600 shadow-sm ring-1 ring-amber-200 hover:bg-amber-50"
																		>
																			{t`Mark Addressed`}
																		</button>
																	)}
																	{c.status === "ADDRESSED" && (
																		<button
																			type="button"
																			onClick={() =>
																				updateCommentStatusMutation.mutate({ id: c.id, status: "RESOLVED" })
																			}
																			className="rounded-lg bg-emerald-600 px-2 py-1 font-semibold text-[10px] text-white shadow-sm hover:bg-emerald-700"
																		>
																			{t`Approve`}
																		</button>
																	)}
																	{c.status === "RESOLVED" && (
																		<button
																			type="button"
																			onClick={() => updateCommentStatusMutation.mutate({ id: c.id, status: "OPEN" })}
																			className="font-medium text-[10px] text-muted-foreground underline hover:text-muted-foreground"
																		>
																			{t`Re-open`}
																		</button>
																	)}
																	<span
																		className={cn(
																			"rounded-full px-2 py-0.5 font-semibold text-[10px] uppercase tracking-tight",
																			c.status === "RESOLVED"
																				? "bg-emerald-50 text-emerald-700"
																				: c.status === "ADDRESSED"
																					? "bg-amber-50 text-amber-700"
																					: "bg-blue-50 text-blue-700",
																		)}
																	>
																		{c.status}
																	</span>
																</div>
															</div>
														</div>

														{/* Replies */}
														{replies.length > 0 && (
															<div className="ml-8 space-y-2 border-border border-l pl-4">
																{replies.map((reply) => (
																	<div
																		key={reply.id}
																		className="space-y-2 rounded-xl border border-border bg-muted/50 p-3 text-xs"
																	>
																		<div className="flex items-center justify-between">
																			<div className="flex items-center gap-2 opacity-60">
																				<span className="font-bold text-[9px] uppercase tracking-tight">{t`Reply`}</span>
																				<span className="text-[9px]">
																					{new Date(reply.createdAt).toLocaleDateString()}
																				</span>
																			</div>

																			<div className="flex items-center gap-1.5">
																				{reply.status === "OPEN" && (
																					<button
																						type="button"
																						onClick={() =>
																							updateCommentStatusMutation.mutate({ id: reply.id, status: "ADDRESSED" })
																						}
																						className="rounded-md border border-amber-200 bg-card px-1.5 py-0.5 font-bold text-[9px] text-amber-600 hover:bg-amber-50"
																					>
																						{t`Mark Addressed`}
																					</button>
																				)}
																				{reply.status === "ADDRESSED" && (
																					<button
																						type="button"
																						onClick={() =>
																							updateCommentStatusMutation.mutate({ id: reply.id, status: "RESOLVED" })
																						}
																						className="rounded-md bg-emerald-600 px-1.5 py-0.5 font-bold text-[9px] text-white hover:bg-emerald-700"
																					>
																						{t`Resolve`}
																					</button>
																				)}
																				{reply.status === "RESOLVED" && (
																					<button
																						type="button"
																						onClick={() =>
																							updateCommentStatusMutation.mutate({ id: reply.id, status: "OPEN" })
																						}
																						className="font-medium text-[9px] text-muted-foreground underline hover:text-muted-foreground"
																					>
																						{t`Re-open`}
																					</button>
																				)}
																				<div
																					className={cn(
																						"rounded-full border px-1.5 py-0.5 font-bold text-[8px] uppercase tracking-wider shadow-sm",
																						reply.status === "RESOLVED"
																							? "border-emerald-200 bg-emerald-100 text-emerald-700"
																							: reply.status === "ADDRESSED"
																								? "border-amber-200 bg-amber-100 text-amber-700"
																								: "border-blue-200 bg-blue-100 text-blue-700",
																					)}
																				>
																					{reply.status === "PUBLISHED" ? "OPEN" : reply.status}
																				</div>
																				{isMine(reply.authorId) && (
																					<button
																						type="button"
																						aria-label={t`Delete this reply`}
																						disabled={deleteCommentMutation.isPending}
																						onClick={() => void removeComment(reply, 0)}
																						className="rounded-md p-0.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
																					>
																						<TrashIcon className="size-3" />
																					</button>
																				)}
																			</div>
																		</div>
																		<p
																			className={cn(
																				"text-foreground leading-relaxed",
																				reply.status === "RESOLVED" && "text-muted-foreground line-through",
																			)}
																		>
																			{reply.content}
																		</p>
																	</div>
																))}
															</div>
														)}
													</div>
												);
											})}
									</div>
								)}
							</div>
						)}

						{/* ── Evaluate ── */}
						{activeTab === "evaluate" && (
							<EvaluatePanel
								key={resumeId}
								resumeId={resumeId}
								engLabsStudentId={engLabsStudentId}
								tenantId={tenantId}
								existingEvaluations={evaluations}
								onDone={() => queryClient.invalidateQueries(reviewQueryKey)}
							/>
						)}

						{/* ── Changes ── */}
						{activeTab === "changes" && (
							<ChangesPanel
								currentData={resume.data}
								baseline={baseline}
								showHighlights={showHighlights}
								onToggleHighlights={setShowHighlights}
							/>
						)}

						{/* ── Timeline ── */}
						{activeTab === "timeline" && (
							<div>
								{history.length === 0 ? (
									<div className="rounded-2xl bg-muted/50 py-10 text-center">
										<ClockCounterClockwiseIcon weight="duotone" className="mx-auto mb-2 size-8 text-muted-foreground" />
										<p className="text-muted-foreground text-sm">No activity recorded yet</p>
									</div>
								) : (
									<StudentTimeline entries={history} />
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function EvaluatePanel({
	resumeId,
	engLabsStudentId,
	tenantId,
	existingEvaluations = [],
	onDone,
}: {
	resumeId: string;
	engLabsStudentId: string;
	tenantId: string;
	existingEvaluations?: any[];
	onDone: () => void;
}) {
	const [selectedChecklistId, setSelectedChecklistId] = useState<string>("");
	const [itemResults, setItemResults] = useState<Record<string, { passed: boolean; score: number; notes: string }>>({});

	useEffect(() => {
		if (!selectedChecklistId || !existingEvaluations.length) return;

		const existing = existingEvaluations.find((e) => e.checklistId === selectedChecklistId);
		if (existing?.items) {
			const results: Record<string, { passed: boolean; score: number; notes: string }> = {};
			for (const item of existing.items) {
				results[item.checklistItemId] = {
					passed: item.passed,
					score: item.score,
					notes: item.notes || "",
				};
			}
			setItemResults(results);
		} else {
			setItemResults({});
		}
	}, [selectedChecklistId, existingEvaluations]);

	const isUpdate = existingEvaluations.some((e) => e.checklistId === selectedChecklistId);

	const { data: checklists } = useQuery(
		orpc.resume.checklists.list.queryOptions({ input: { tenantId, studentId: engLabsStudentId } }),
	);

	const { data: checklist } = useQuery({
		...orpc.resume.checklists.get.queryOptions({ input: { checklistId: selectedChecklistId } }),
		enabled: !!selectedChecklistId,
	});

	const evalMutation = useMutation({
		...orpc.resume.evaluations.create.mutationOptions(),
		onSuccess: () => {
			setSelectedChecklistId("");
			setItemResults({});
			onDone();
		},
	});

	const getItemResult = (itemId: string) => itemResults[itemId] ?? { passed: false, score: 3, notes: "" };

	const setItemResult = (itemId: string, update: Partial<{ passed: boolean; score: number; notes: string }>) => {
		setItemResults((prev) => ({ ...prev, [itemId]: { ...getItemResult(itemId), ...update } }));
	};
	const totalChecklistWeight = checklist?.items?.reduce((sum, item) => sum + (item.weight ?? 1), 0) ?? 0;
	const getScoreShare = (weight: number) => (totalChecklistWeight > 0 ? (weight / totalChecklistWeight) * 100 : 0);
	const formatPercent = (value: number) => `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
	const getScoreShareBadgeClass = (share: number) => {
		if (share >= 20) return "bg-rose-100 text-rose-700";
		if (share >= 10) return "bg-amber-100 text-amber-700";
		return "bg-emerald-100 text-emerald-700";
	};

	if (!checklists || checklists.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<ListChecksIcon weight="duotone" className="mb-3 size-10 text-muted-foreground" />
				<p className="font-semibold text-muted-foreground">No checklists available</p>
				<p className="mt-1 text-muted-foreground text-sm">
					Go to the Checklists tab to create an evaluation checklist first.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-5">
			{/* Select checklist */}
			<div>
				<p className="mb-2 font-semibold text-foreground text-sm">Select Checklist</p>
				<div className="flex flex-wrap gap-2">
					{checklists.map((cl) => (
						<button
							key={cl.id}
							type="button"
							onClick={() => {
								setSelectedChecklistId(cl.id);
								setItemResults({});
							}}
							className={cn(
								"rounded-xl px-3 py-2 font-semibold text-sm transition-all",
								selectedChecklistId === cl.id
									? "bg-primary text-white"
									: "bg-muted text-muted-foreground hover:bg-border",
							)}
						>
							{cl.title}
						</button>
					))}
				</div>
			</div>

			{/* Checklist items */}
			{checklist?.items && checklist.items.length > 0 && (
				<div className="space-y-3">
					<p className="font-semibold text-muted-foreground text-xs uppercase tracking-widest">Evaluation Criteria</p>
					<p className="-mt-1 text-muted-foreground text-xs">
						Each item contributes a share of the final score based on its weight. Higher weight means a higher score
						share.
					</p>
					{checklist.items.map((item) => {
						const result = getItemResult(item.id);
						return (
							<div key={item.id} className="rounded-2xl bg-muted/50 p-4">
								<div className="mb-3 flex items-start justify-between gap-2">
									<div>
										<p className="font-semibold text-foreground text-sm">{item.title}</p>
										{item.description && <p className="text-muted-foreground text-xs">{item.description}</p>}
									</div>
									<span
										className={cn(
											"shrink-0 rounded-lg px-2 py-0.5 text-xs",
											getScoreShareBadgeClass(getScoreShare(item.weight ?? 1)),
										)}
										title={`This item contributes ${formatPercent(getScoreShare(item.weight ?? 1))} of the final score.`}
									>
										Score Share {formatPercent(getScoreShare(item.weight ?? 1))}
									</span>
								</div>
								<div className="flex items-center gap-3">
									<button
										type="button"
										onClick={() => setItemResult(item.id, { passed: !result.passed })}
										className={cn(
											"rounded-xl px-3 py-1.5 font-semibold text-xs transition-all",
											result.passed
												? "bg-emerald-600 text-white"
												: "bg-border text-muted-foreground hover:bg-muted-foreground/30",
										)}
									>
										{result.passed ? "✓ Passed" : "✗ Not Passed"}
									</button>
									<div className="flex items-center gap-1">
										{[1, 2, 3, 4, 5].map((s) => (
											<button
												key={s}
												type="button"
												onClick={() => setItemResult(item.id, { score: s })}
												className={cn(
													"h-7 w-7 rounded-lg font-bold text-xs transition-all",
													result.score === s ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted",
												)}
											>
												{s}
											</button>
										))}
									</div>
								</div>
								<input
									type="text"
									placeholder="Notes (optional)..."
									value={result.notes}
									onChange={(e) => setItemResult(item.id, { notes: e.target.value })}
									className="mt-2 w-full rounded-xl border-0 bg-card px-3 py-2 text-foreground text-xs outline-none ring-1 ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-primary"
								/>
							</div>
						);
					})}

					<button
						type="button"
						disabled={evalMutation.isPending || !engLabsStudentId}
						onClick={() => {
							if (!checklist.items) return;
							evalMutation.mutate({
								resumeId,
								studentId: engLabsStudentId,
								checklistId: selectedChecklistId,
								tenantId,
								isAutoGenerated: false,
								items: checklist.items.map((item) => {
									const r = getItemResult(item.id);
									return {
										checklistItemId: item.id,
										passed: r.passed,
										score: r.score,
										notes: r.notes || undefined,
									};
								}),
							});
						}}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white transition-all hover:bg-primary/90 disabled:opacity-50"
					>
						<CheckCircleIcon weight="duotone" className="size-5" />
						{evalMutation.isPending ? "Submitting…" : isUpdate ? "Update Evaluation" : "Submit Evaluation"}
					</button>
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Word-level diff helpers for the Changes tab
// ---------------------------------------------------------------------------

function getValueAtPath(obj: any, path: string): unknown {
	const parts = path.split("/").filter(Boolean);
	let current: any = obj;
	for (const part of parts) {
		if (current == null) return undefined;
		current = current[part];
	}
	return current;
}

function toPlainText(val: unknown): string {
	if (val == null) return "";
	if (typeof val !== "string") return JSON.stringify(val);
	return val
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<\/?(p|li|ul|ol|div|span|strong|em|b|i|h[1-6])[^>]*>/gi, " ")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s+/g, " ")
		.trim();
}

type WordToken = { type: "same" | "add" | "remove"; text: string };

function computeWordDiff(oldText: string, newText: string): WordToken[] {
	const tok = (s: string) => s.split(/(\s+)/);
	const a = tok(oldText);
	const b = tok(newText);
	const m = a.length,
		n = b.length;

	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i]![j]! = a[i] === b[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}

	const out: WordToken[] = [];
	let i = 0,
		j = 0;
	while (i < m && j < n) {
		if (a[i] === b[j]) {
			out.push({ type: "same", text: a[i]! });
			i++;
			j++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
			out.push({ type: "remove", text: a[i]! });
			i++;
		} else {
			out.push({ type: "add", text: b[j]! });
			j++;
		}
	}
	while (i < m) out.push({ type: "remove", text: a[i++]! });
	while (j < n) out.push({ type: "add", text: b[j++]! });
	return out;
}

/** Escape plain text for safe HTML embedding. */
function esc(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDiffHtml(tokens: WordToken[]): string {
	return tokens
		.map(({ type, text }) => {
			// Escape the raw text so the resume content can't inject HTML
			const e = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
			if (type === "add")
				return `<ins style="background-color:#e6ffed;text-decoration:none;border-bottom:2px solid #2cbe4e;padding:0 1px;">${e}</ins>`;
			if (type === "remove")
				return `<del style="background-color:#ffeef0;text-decoration:line-through;color:#b31d28;padding:0 1px;">${e}</del>`;
			return e;
		})
		.join("");
}

/**
 * Renders the complete resume as a styled HTML document with word-level
 * <ins>/<del> diff markers injected at every changed field.
 * Unchanged fields render as plain text. Every section is always shown.
 * Uses schema-correct field names (no data loss).
 */
function buildFullDiffHtml(currentData: any, snapshot: any, ops: ReturnType<typeof jsonpatch.compare>): string {
	// 1. Build diff map: JSON path → diff HTML
	const diffMap = new Map<string, string>();
	for (const op of ops) {
		const oldVal = getValueAtPath(snapshot, op.path);
		const newVal = (op as any).value as unknown;
		const oldText = toPlainText(oldVal);
		const newText = op.op === "remove" ? "" : toPlainText(newVal);
		let dHtml = "";
		if (op.op === "replace") {
			dHtml = buildDiffHtml(computeWordDiff(oldText, newText));
		} else if (op.op === "add") {
			dHtml = `<ins style="background-color:#e6ffed;text-decoration:none;border-bottom:2px solid #2cbe4e;padding:0 1px;">${esc(newText)}</ins>`;
		} else {
			dHtml = `<del style="background-color:#ffeef0;text-decoration:line-through;color:#b31d28;padding:0 1px;">${esc(oldText)}</del>`;
		}
		diffMap.set(op.path, dHtml);
	}

	// 2. field() helper: returns diff HTML if this path changed, else escaped plain text
	const field = (path: string, val: unknown): string => {
		if (diffMap.has(path)) return diffMap.get(path)!;
		const t = toPlainText(val);
		return t ? esc(t) : "";
	};

	// 3. Shared inline styles
	const ST = {
		sectionTitle:
			"font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.12em;color:#94a3b8;display:block;margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid #f1f5f9;",
		primaryRow: "font-size:14px;font-weight:600;color:#0f172a;line-height:1.3;",
		secondaryRow: "font-size:12px;color:#64748b;margin-top:3px;",
		metaRow: "font-size:11px;color:#94a3b8;margin-top:2px;",
		bodyText: "font-size:13px;color:#475569;margin:6px 0 0;line-height:1.6;",
		itemDivider: "border-top:1px solid #f8fafc;margin-top:12px;padding-top:12px;",
	};

	let html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.65;color:#1e293b;padding:20px;">`;

	// 4. BASICS — name, headline, email (string), phone (string), location (string)
	{
		const b = currentData?.basics;
		if (b) {
			html += `<div style="margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e2e8f0;">`;
			const nameH = field("/basics/name", b.name);
			if (nameH) html += `<div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.2;">${nameH}</div>`;
			const hlH = field("/basics/headline", b.headline);
			if (hlH) html += `<div style="font-size:14px;color:#64748b;margin-top:3px;">${hlH}</div>`;
			// email + phone are plain strings (not .value objects), location is also a plain string
			const contacts: string[] = [];
			if (b.email) contacts.push(field("/basics/email", b.email));
			if (b.phone) contacts.push(field("/basics/phone", b.phone));
			if (b.location) contacts.push(field("/basics/location", b.location));
			const filteredContacts = contacts.filter(Boolean);
			if (filteredContacts.length)
				html += `<div style="font-size:12px;color:#94a3b8;margin-top:5px;">${filteredContacts.join(" · ")}</div>`;
			// website
			if (b.website?.url) {
				const wH = field("/basics/website/url", b.website.url);
				if (wH) html += `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">↗ ${wH}</div>`;
			}
			html += `</div>`;
		}
	}

	// 5. SECTIONS — ordered by metadata.layout (same order the resume template uses).
	// layout is string[][][] (pages → columns → section keys).
	// "summary" is the top-level summary field; all others are in data.sections or data.customSections.
	const FALLBACK_ORDER = [
		"summary",
		"profiles",
		"experience",
		"education",
		"projects",
		"skills",
		"languages",
		"interests",
		"awards",
		"certifications",
		"publications",
		"volunteer",
		"references",
	];
	const layoutPages = currentData?.metadata?.layout?.pages;
	const orderedKeys: string[] = Array.isArray(layoutPages)
		? [
				...new Set(
					(layoutPages as Array<{ main?: string[]; sidebar?: string[] }>)
						.flatMap((p) => [...(p.main ?? []), ...(p.sidebar ?? [])])
						.filter(Boolean),
				),
			]
		: FALLBACK_ORDER;

	for (const key of orderedKeys) {
		// ── "summary" is the top-level summary field, not a section ──
		if (key === "summary") {
			const summaryData = currentData?.summary;
			if (summaryData && !summaryData.hidden && summaryData.content) {
				html += `<div style="margin-bottom:24px;">`;
				html += `<span style="${ST.sectionTitle}">${esc(summaryData.title || "Summary")}</span>`;
				const contentH = field("/summary/content", summaryData.content);
				if (contentH) html += `<p style="${ST.bodyText};margin-top:0;">${contentH}</p>`;
				html += `</div>`;
			}
			continue;
		}

		// ── Custom section referenced by its UUID id ──
		if (!(key in (currentData?.sections ?? {}))) {
			const csIdx = (currentData?.customSections as any[] | undefined)?.findIndex((s: any) => s.id === key) ?? -1;
			if (csIdx >= 0) {
				const cSection = (currentData.customSections as any[])[csIdx];
				if (cSection?.items?.length) {
					html += `<div style="margin-bottom:24px;">`;
					html += `<span style="${ST.sectionTitle}">${esc(cSection.title || "Custom")}</span>`;
					for (let idx = 0; idx < cSection.items.length; idx++) {
						const item = cSection.items[idx];
						if (item?.hidden) continue;
						const base = `/customSections/${csIdx}/items/${idx}`;
						html += idx > 0 ? `<div style="${ST.itemDivider}">` : `<div>`;
						if (item.name) {
							const h = field(`${base}/name`, item.name);
							if (h) html += `<div style="${ST.primaryRow}">${h}</div>`;
						}
						if (item.title) {
							const h = field(`${base}/title`, item.title);
							if (h) html += `<div style="${ST.primaryRow}">${h}</div>`;
						}
						if (item.content) {
							const h = field(`${base}/content`, item.content);
							if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
						}
						if (item.description) {
							const h = field(`${base}/description`, item.description);
							if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
						}
						html += `</div>`;
					}
					html += `</div>`;
				}
			}
			continue;
		}

		// ── Fixed section ──
		{
			const section = currentData?.sections?.[key];
			if (!section?.items?.length) continue;

			html += `<div style="margin-bottom:24px;">`;
			html += `<span style="${ST.sectionTitle}">${esc(section.title || key)}</span>`;

			for (let idx = 0; idx < section.items.length; idx++) {
				const item = section.items[idx];
				if (item?.hidden) continue;
				const base = `/sections/${key}/items/${idx}`;

				html += idx > 0 ? `<div style="${ST.itemDivider}">` : `<div>`;

				if (key === "experience") {
					// company (string), position (string), location (string), period (string), website, description
					const company = field(`${base}/company`, item.company);
					const position = field(`${base}/position`, item.position);
					const parts = [position, company].filter(Boolean);
					if (parts.length) html += `<div style="${ST.primaryRow}">${parts.join(" @ ")}</div>`;
					const period = field(`${base}/period`, item.period);
					const location = field(`${base}/location`, item.location);
					const meta = [period, location].filter(Boolean);
					if (meta.length) html += `<div style="${ST.metaRow}">${meta.join(" · ")}</div>`;
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				} else if (key === "education") {
					// school (string), degree (string), area (string), grade (string), location (string), period (string), website, description
					const school = field(`${base}/school`, item.school);
					if (school) html += `<div style="${ST.primaryRow}">${school}</div>`;
					const degree = field(`${base}/degree`, item.degree);
					const area = field(`${base}/area`, item.area);
					const degreeArea = [degree, area].filter(Boolean).join(", ");
					if (degreeArea) html += `<div style="${ST.secondaryRow}">${degreeArea}</div>`;
					const period = field(`${base}/period`, item.period);
					const grade = field(`${base}/grade`, item.grade);
					const location = field(`${base}/location`, item.location);
					const meta = [period, grade, location].filter(Boolean);
					if (meta.length) html += `<div style="${ST.metaRow}">${meta.join(" · ")}</div>`;
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
				} else if (key === "profiles") {
					// network (string), username (string), website
					const network = field(`${base}/network`, item.network);
					const username = field(`${base}/username`, item.username);
					if (network) html += `<div style="${ST.primaryRow}">${network}</div>`;
					if (username) html += `<div style="${ST.secondaryRow}">${username}</div>`;
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				} else if (key === "skills") {
					// name (string), proficiency (string), level (numeric — hidden), keywords[]
					const name = field(`${base}/name`, item.name);
					const proficiency = field(`${base}/proficiency`, item.proficiency);
					if (name) html += `<div style="${ST.primaryRow}">${name}</div>`;
					if (proficiency) html += `<div style="${ST.secondaryRow}">${proficiency}</div>`;
					const kw = (item.keywords as string[] | undefined)?.filter(Boolean);
					if (kw?.length) html += `<div style="${ST.metaRow}">${esc(kw.join(", "))}</div>`;
				} else if (key === "languages") {
					// language (string), fluency (string), level (numeric — hidden)
					const language = field(`${base}/language`, item.language);
					const fluency = field(`${base}/fluency`, item.fluency);
					if (language) html += `<div style="${ST.primaryRow}">${language}</div>`;
					if (fluency) html += `<div style="${ST.secondaryRow}">${fluency}</div>`;
				} else if (key === "interests") {
					// name (string), keywords[]
					const name = field(`${base}/name`, item.name);
					if (name) html += `<div style="${ST.primaryRow}">${name}</div>`;
					const kw = (item.keywords as string[] | undefined)?.filter(Boolean);
					if (kw?.length) html += `<div style="${ST.metaRow}">${esc(kw.join(", "))}</div>`;
				} else if (key === "projects") {
					// name (string), period (string), website, description
					const name = field(`${base}/name`, item.name);
					if (name) html += `<div style="${ST.primaryRow}">${name}</div>`;
					const period = field(`${base}/period`, item.period);
					if (period) html += `<div style="${ST.metaRow}">${period}</div>`;
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				} else if (key === "awards") {
					// title (string), awarder (string), date (string), website, description
					const title = field(`${base}/title`, item.title);
					const awarder = field(`${base}/awarder`, item.awarder);
					if (title) html += `<div style="${ST.primaryRow}">${title}</div>`;
					if (awarder) html += `<div style="${ST.secondaryRow}">${awarder}</div>`;
					if (item.date) {
						const h = field(`${base}/date`, item.date);
						if (h) html += `<div style="${ST.metaRow}">${h}</div>`;
					}
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
				} else if (key === "certifications") {
					// title (string), issuer (string), date (string), website, description
					const title = field(`${base}/title`, item.title);
					const issuer = field(`${base}/issuer`, item.issuer);
					if (title) html += `<div style="${ST.primaryRow}">${title}</div>`;
					if (issuer) html += `<div style="${ST.secondaryRow}">${issuer}</div>`;
					if (item.date) {
						const h = field(`${base}/date`, item.date);
						if (h) html += `<div style="${ST.metaRow}">${h}</div>`;
					}
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				} else if (key === "publications") {
					// title (string), publisher (string), date (string), website, description
					const title = field(`${base}/title`, item.title);
					const publisher = field(`${base}/publisher`, item.publisher);
					if (title) html += `<div style="${ST.primaryRow}">${title}</div>`;
					if (publisher) html += `<div style="${ST.secondaryRow}">${publisher}</div>`;
					if (item.date) {
						const h = field(`${base}/date`, item.date);
						if (h) html += `<div style="${ST.metaRow}">${h}</div>`;
					}
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				} else if (key === "volunteer") {
					// organization (string), location (string), period (string), website, description
					const org = field(`${base}/organization`, item.organization);
					if (org) html += `<div style="${ST.primaryRow}">${org}</div>`;
					const period = field(`${base}/period`, item.period);
					const location = field(`${base}/location`, item.location);
					const meta = [period, location].filter(Boolean);
					if (meta.length) html += `<div style="${ST.metaRow}">${meta.join(" · ")}</div>`;
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				} else if (key === "references") {
					// name (string), position (string), phone (string), website, description
					const name = field(`${base}/name`, item.name);
					const position = field(`${base}/position`, item.position);
					if (name) html += `<div style="${ST.primaryRow}">${name}</div>`;
					if (position) html += `<div style="${ST.secondaryRow}">${position}</div>`;
					if (item.phone) {
						const h = field(`${base}/phone`, item.phone);
						if (h) html += `<div style="${ST.metaRow}">${h}</div>`;
					}
					if (item.description) {
						const h = field(`${base}/description`, item.description);
						if (h) html += `<p style="${ST.bodyText}">${h}</p>`;
					}
					if (item.website?.url) {
						const h = field(`${base}/website/url`, item.website.url);
						if (h) html += `<div style="${ST.metaRow}">↗ ${h}</div>`;
					}
				}

				html += `</div>`; // item
			}

			html += `</div>`; // section
		} // end fixed section block
	} // end layout loop

	html += `</div>`;
	return html;
}

// ---------------------------------------------------------------------------

type ReviewBaseline = { data: ResumeData; at: Date };

/**
 * Copies of the resume as reviewers saw it, newest first: kept with a review round's first comment, an
 * evaluation, or a verdict (request revision / verify / approve).
 */
function reviewCopies(
	evaluations: { snapshot?: unknown; evaluatedAt: Date | string }[],
	history: { currentData?: unknown; createdAt: Date | string }[],
	comments: { snapshot?: unknown; createdAt: Date | string }[],
): ReviewBaseline[] {
	return [
		...evaluations.filter((e) => e.snapshot).map((e) => ({ data: e.snapshot, at: new Date(e.evaluatedAt) })),
		...history.filter((h) => h.currentData).map((h) => ({ data: h.currentData, at: new Date(h.createdAt) })),
		...comments.filter((c) => c.snapshot).map((c) => ({ data: c.snapshot, at: new Date(c.createdAt) })),
	].sort((a, b) => b.at.getTime() - a.at.getTime()) as ReviewBaseline[];
}

/** A comment's spot as it was when the comment was made, next to how it reads now. */
function BeforeAfter({ anchor, before, now }: { anchor: CommentAnchor; before?: ResumeData; now: ResumeData }) {
	// Comments made before resume copies were kept only know the highlighted text.
	const was = before ? anchorText(before, anchor) : (anchor.quote?.exact ?? null);
	const is = anchorText(now, anchor);
	const tokens = before && was && is ? computeWordDiff(was, is) : null;

	const row = (label: string, body: React.ReactNode) => (
		<div className="grid grid-cols-[3.5rem_1fr] gap-2">
			<span className="font-semibold text-muted-foreground">{label}</span>
			<p className="text-foreground leading-relaxed">{body}</p>
		</div>
	);

	return (
		<div className="mt-3 space-y-1.5 rounded-lg border border-primary/10 bg-primary/5 p-3 text-xs">
			{row(
				t`Before`,
				tokens
					? tokens.map((tok, i) =>
							tok.type === "add" ? null : tok.type === "remove" ? (
								<del key={i} className="bg-rose-100 text-rose-800">
									{tok.text}
								</del>
							) : (
								tok.text
							),
						)
					: (was ?? "—"),
			)}
			{row(
				t`Now`,
				is === null ? (
					<span className="text-muted-foreground italic">{t`Removed from the resume`}</span>
				) : tokens ? (
					tokens.map((tok, i) =>
						tok.type === "remove" ? null : tok.type === "add" ? (
							<ins key={i} className="bg-emerald-100 text-emerald-800 no-underline">
								{tok.text}
							</ins>
						) : (
							tok.text
						),
					)
				) : (
					is
				),
			)}
			{was === is && <p className="text-muted-foreground">{t`Not changed yet.`}</p>}
		</div>
	);
}

function ChangesPanel({
	currentData,
	baseline,
	showHighlights,
	onToggleHighlights,
}: {
	currentData: any;
	baseline: ReviewBaseline | null;
	showHighlights: boolean;
	onToggleHighlights: (v: boolean) => void;
}) {
	const diff = useMemo(() => {
		if (!baseline || !currentData) return [];
		return jsonpatch.compare(baseline.data, currentData);
	}, [baseline, currentData]);

	// Full HTML resume with <ins>/<del> markers at every changed field
	const fullDiffHtml = useMemo(() => {
		if (!baseline || !currentData || diff.length === 0) return null;
		return buildFullDiffHtml(currentData, baseline.data, diff);
	}, [currentData, baseline, diff]);

	if (!baseline) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<ShootingStarIcon weight="duotone" className="mb-3 size-10 text-muted-foreground" />
				<p className="font-semibold text-muted-foreground">{t`No comparison available`}</p>
				<p className="mt-1 text-muted-foreground text-sm">
					{t`Changes show up here after you request a revision, verify, or evaluate this resume.`}
				</p>
			</div>
		);
	}

	if (diff.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-center">
				<CheckCircleIcon weight="duotone" className="mb-3 size-10 text-emerald-300" />
				<p className="font-semibold text-muted-foreground">{t`No new changes`}</p>
				<p className="mt-1 text-muted-foreground text-sm">
					{t`The student hasn't made any changes since the review on ${baseline.at.toLocaleDateString()}.`}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<span className="font-semibold text-foreground text-sm">{t`Changes Summary`}</span>
				<label className="flex cursor-pointer items-center gap-2">
					<span className="text-[10px] text-muted-foreground uppercase tracking-wider">Show in Resume</span>
					<input
						type="checkbox"
						checked={showHighlights}
						onChange={(e) => onToggleHighlights(e.target.checked)}
						className="size-3.5 rounded-sm border-border text-primary focus:ring-primary"
					/>
				</label>
			</div>

			{/* Snapshot banner */}
			<div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-amber-800 text-xs">
				<p className="mb-1 flex items-center gap-1.5 font-bold">
					<ShootingStarIcon className="size-4" />
					Snapshot from {baseline.at.toLocaleDateString()}
				</p>
				<p className="opacity-80">
					{diff.length} change{diff.length !== 1 ? "s" : ""} detected since that review.
				</p>
			</div>

			{/* Legend */}
			<div className="flex items-center gap-4 rounded-lg bg-muted/50 px-3 py-2 text-[10px] text-muted-foreground">
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-3 rounded-sm border border-green-400 bg-green-100" />
					Added
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-3 rounded-sm border border-red-300 bg-red-100" />
					Removed
				</span>
			</div>

			{/* Full resume diff view — every section shown with inline <ins>/<del> */}
			{fullDiffHtml && (
				<div
					className="rounded-xl border border-border bg-card shadow-sm"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: constructed from escaped tokens
					dangerouslySetInnerHTML={{ __html: fullDiffHtml }}
				/>
			)}
		</div>
	);
}

function ComparisonOverlay({
	baseline,
	currentData,
	onTabChange,
}: {
	baseline: ReviewBaseline | null;
	currentData: any;
	onTabChange: (tab: ReviewTab) => void;
}) {
	const diff = useMemo(() => {
		if (!baseline || !currentData) return [];
		return jsonpatch.compare(baseline.data, currentData);
	}, [baseline, currentData]);

	if (diff.length === 0) return null;

	return (
		<div className="flex h-9 shrink-0 items-center justify-between bg-amber-500 px-6 text-white text-xs shadow-inner">
			<div className="flex items-center gap-2 font-medium">
				<PlusMinusIcon weight="bold" className="size-4" />
				<span>{diff.length} changes detected since your last review</span>
			</div>
			<button type="button" onClick={() => onTabChange("changes")} className="font-bold hover:underline">
				Review Changes →
			</button>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Revision Diff — text extraction + LCS diff + document-style HTML renderer
// ---------------------------------------------------------------------------

type DiffLine = { type: "same" | "add" | "remove"; text: string };

/** Extract human-readable lines from resume JSON in section order. */
function extractResumeLines(data: any): string[] {
	const lines: string[] = [];

	const stripHtml = (html: string) =>
		html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/?(p|li|ul|ol|div)[^>]*>/gi, "\n")
			.replace(/<[^>]+>/g, "")
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
			.join(" ");

	// Basics — email/phone/location are plain strings
	const b = data?.basics;
	if (b) {
		if (b.name) lines.push(`Name: ${b.name}`);
		if (b.headline) lines.push(`Headline: ${b.headline}`);
		if (b.email) lines.push(`Email: ${b.email}`);
		if (b.phone) lines.push(`Phone: ${b.phone}`);
		if (b.location) lines.push(`Location: ${b.location}`);
		if (b.website?.url) lines.push(`Website: ${b.website.url}`);
	}

	// Summary — top-level data.summary (NOT in basics)
	if (data?.summary?.content) {
		const t = stripHtml(data.summary.content);
		if (t) {
			lines.push("─── Summary ───");
			lines.push(t);
		}
	}

	const sectionKeys = [
		"profiles",
		"experience",
		"education",
		"projects",
		"skills",
		"languages",
		"interests",
		"awards",
		"certifications",
		"publications",
		"volunteer",
		"references",
	];

	for (const key of sectionKeys) {
		const section = data?.sections?.[key];
		if (!section?.items?.length) continue;

		lines.push(`─── ${section.title || key.charAt(0).toUpperCase() + key.slice(1)} ───`);

		for (const item of section.items) {
			if (item.hidden) continue;
			const parts: string[] = [];
			// Per-section field names (schema-correct)
			if (key === "experience") {
				if (item.position) parts.push(item.position);
				if (item.company) parts.push(`@ ${item.company}`);
				if (item.period) parts.push(`(${item.period})`);
				if (item.location) parts.push(item.location);
			} else if (key === "education") {
				if (item.school) parts.push(item.school);
				if (item.degree) parts.push(item.degree);
				if (item.area) parts.push(item.area);
				if (item.period) parts.push(`(${item.period})`);
				if (item.grade) parts.push(`Grade: ${item.grade}`);
			} else if (key === "profiles") {
				if (item.network) parts.push(item.network);
				if (item.username) parts.push(item.username);
			} else if (key === "skills") {
				if (item.name) parts.push(item.name);
				if (item.proficiency) parts.push(item.proficiency);
			} else if (key === "languages") {
				if (item.language) parts.push(item.language);
				if (item.fluency) parts.push(item.fluency);
			} else if (key === "interests") {
				if (item.name) parts.push(item.name);
			} else if (key === "projects") {
				if (item.name) parts.push(item.name);
				if (item.period) parts.push(`(${item.period})`);
			} else if (key === "awards" || key === "certifications" || key === "publications") {
				if (item.title) parts.push(item.title);
				if (item.awarder) parts.push(`by ${item.awarder}`);
				if (item.issuer) parts.push(`by ${item.issuer}`);
				if (item.publisher) parts.push(`by ${item.publisher}`);
				if (item.date) parts.push(`(${item.date})`);
			} else if (key === "volunteer") {
				if (item.organization) parts.push(item.organization);
				if (item.period) parts.push(`(${item.period})`);
				if (item.location) parts.push(item.location);
			} else if (key === "references") {
				if (item.name) parts.push(item.name);
				if (item.position) parts.push(item.position);
			} else {
				// fallback for any unknown section
				if (item.name) parts.push(item.name);
				if (item.title) parts.push(item.title);
				if (item.period) parts.push(`(${item.period})`);
			}
			if (parts.length) lines.push(parts.join(" "));
			if (item.description) lines.push(stripHtml(item.description));
			if (item.content) lines.push(stripHtml(item.content));
			if (item.website?.url) lines.push(`↗ ${item.website.url}`);
			if (item.keywords?.length) lines.push(`Keywords: ${item.keywords.join(", ")}`);
		}
	}

	// Custom sections — data.customSections is an array
	const customSections = data?.customSections;
	if (Array.isArray(customSections)) {
		for (const section of customSections) {
			if (!section?.items?.length) continue;
			lines.push(`─── ${section.title || "Custom"} ───`);
			for (const item of section.items) {
				if (item.hidden) continue;
				if (item.name) lines.push(item.name);
				if (item.title) lines.push(item.title);
				if (item.description) lines.push(stripHtml(item.description));
				if (item.content) lines.push(stripHtml(item.content));
			}
		}
	}

	return lines.filter((l) => l.trim());
}

/** LCS-based line diff. Returns array of {type, text} entries. */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
	const m = oldLines.length;
	const n = newLines.length;

	// Build DP table
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i][j] = oldLines[i] === newLines[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const result: DiffLine[] = [];
	let i = 0,
		j = 0;
	while (i < m && j < n) {
		if (oldLines[i] === newLines[j]) {
			result.push({ type: "same", text: oldLines[i]! });
			i++;
			j++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
			result.push({ type: "remove", text: oldLines[i]! });
			i++;
		} else {
			result.push({ type: "add", text: newLines[j]! });
			j++;
		}
	}
	while (i < m) result.push({ type: "remove", text: oldLines[i++]! });
	while (j < n) result.push({ type: "add", text: newLines[j++]! });

	return result;
}

function RevisionDiffOverlay({
	snapshot,
	currentData,
	evaluatedAt,
	onClose,
}: {
	snapshot: any;
	currentData: any;
	evaluatedAt: Date | string;
	onClose: () => void;
}) {
	const snapshotLines = useMemo(() => extractResumeLines(snapshot), [snapshot]);
	const currentLines = useMemo(() => extractResumeLines(currentData), [currentData]);
	const diff = useMemo(() => computeLineDiff(snapshotLines, currentLines), [snapshotLines, currentLines]);

	const added = diff.filter((d) => d.type === "add").length;
	const removed = diff.filter((d) => d.type === "remove").length;
	const unchanged = diff.filter((d) => d.type === "same").length;

	const evalDate = new Date(evaluatedAt).toLocaleDateString(undefined, { dateStyle: "long" });

	return (
		<div className="absolute inset-0 z-50 flex flex-col bg-card">
			{/* Header */}
			<div className="flex shrink-0 items-center gap-4 border-border border-b px-6 py-3">
				<div className="flex items-center gap-2 text-primary">
					<GitDiffIcon weight="duotone" className="size-5" />
					<h2 className="font-bold text-foreground">Before &amp; After</h2>
				</div>
				<p className="text-muted-foreground text-xs">
					Comparing current resume against evaluation snapshot from {evalDate}
				</p>
				<div className="ml-auto flex items-center gap-3">
					<div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5 text-xs">
						<span className="font-bold text-emerald-600">+{added}</span>
						<span className="text-muted-foreground">added</span>
						<span className="mx-1 text-muted-foreground">|</span>
						<span className="font-bold text-red-500">−{removed}</span>
						<span className="text-muted-foreground">removed</span>
						<span className="mx-1 text-muted-foreground">|</span>
						<span className="font-bold text-muted-foreground">{unchanged}</span>
						<span className="text-muted-foreground">unchanged</span>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-all hover:bg-border"
					>
						<XIcon weight="bold" className="size-4" />
					</button>
				</div>
			</div>

			{/* Legend */}
			<div className="flex shrink-0 items-center gap-6 border-border border-b bg-muted/50 px-6 py-2">
				<div className="flex items-center gap-2 text-xs">
					<span className="inline-block h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-300" />
					<span className="text-muted-foreground">Added in current version</span>
				</div>
				<div className="flex items-center gap-2 text-xs">
					<span className="inline-block h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-300" />
					<span className="text-muted-foreground">Removed from snapshot</span>
				</div>
				<div className="flex items-center gap-2 text-xs">
					<span className="inline-block h-3 w-3 rounded-sm bg-card ring-1 ring-border" />
					<span className="text-muted-foreground">Unchanged</span>
				</div>
			</div>

			{/* Diff content */}
			<div className="flex-1 overflow-y-auto">
				{diff.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center text-center">
						<CheckCircleIcon weight="duotone" className="mb-3 size-12 text-emerald-300" />
						<p className="font-semibold text-muted-foreground">No changes found</p>
						<p className="mt-1 text-muted-foreground text-sm">
							The resume content is identical to the evaluation snapshot.
						</p>
					</div>
				) : (
					<div className="mx-auto max-w-3xl px-8 py-6">
						<div className="overflow-hidden rounded-2xl border border-border font-mono text-sm shadow-sm">
							{diff.map((line, i) => {
								const isHeader = line.text.startsWith("───");
								return (
									<div
										key={i}
										className={cn(
											"flex items-baseline gap-3 border-border border-b px-4 py-1.5 last:border-b-0",
											line.type === "add" && "bg-emerald-50",
											line.type === "remove" && "bg-red-50",
											line.type === "same" && "bg-card",
											isHeader && "border-border bg-muted/50 py-2",
										)}
									>
										{/* Gutter */}
										<span
											className={cn(
												"w-4 shrink-0 select-none text-center font-bold",
												line.type === "add" && "text-emerald-500",
												line.type === "remove" && "text-red-400",
												line.type === "same" && "text-muted-foreground",
											)}
										>
											{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
										</span>

										{/* Content */}
										<span
											className={cn(
												"flex-1 whitespace-pre-wrap break-words leading-relaxed",
												line.type === "add" && "text-emerald-800",
												line.type === "remove" && "text-red-700 line-through opacity-75",
												line.type === "same" &&
													(isHeader
														? "font-bold text-muted-foreground text-xs uppercase tracking-widest"
														: "text-muted-foreground"),
											)}
										>
											{line.text}
										</span>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
