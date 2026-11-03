import {
	ArrowSquareOutIcon,
	ChatDotsIcon,
	ClockCounterClockwiseIcon,
	DownloadSimpleIcon,
	FileTextIcon,
	PaperPlaneTiltIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/integrations/orpc/client";
import { cn } from "@/utils/style";
import { getEvaluationBadgeClass, getStatusBadgeClass } from "./score-helpers";
import { StudentTimeline } from "./student-timeline";
import { useResumeDownload } from "./use-resume-download";

type StudentDetailPanelProps = {
	student: {
		engLabsId: string;
		name: string;
		email: string;
		rollNumber: string | null;
		sectionName: string | null;
		resumeAppUserId: string | null;
		resumes: Array<{
			id: string;
			name: string;
			status: string;
			evaluationScore: number | null;
			commentCount: number;
			isSubmitted: boolean;
		}>;
	};
	tenantId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function StudentDetailPanel({ student, tenantId, open, onOpenChange }: StudentDetailPanelProps) {
	const [activeTab, setActiveTab] = useState<"resumes" | "timeline">("resumes");
	const [expandedResumeId, setExpandedResumeId] = useState<string | null>(null);
	const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
	const { download, isPending: isDownloading } = useResumeDownload();
	const queryClient = useQueryClient();

	const { data: detail, isLoading } = useQuery({
		...orpc.resume.dashboard.studentResumes.queryOptions({
			input: { resumeAppUserId: student.resumeAppUserId ?? "" },
		}),
		enabled: open && !!student.resumeAppUserId,
	});

	const addCommentMutation = useMutation({
		...orpc.resume.comments.create.mutationOptions(),
		onSuccess: (_, variables) => {
			setCommentInputs((prev) => ({ ...prev, [variables.resumeId]: "" }));
			queryClient.invalidateQueries(
				orpc.resume.dashboard.studentResumes.queryOptions({
					input: { resumeAppUserId: student.resumeAppUserId ?? "" },
				}),
			);
		},
	});

	if (!open) return null;

	return (
		<>
			{/* Backdrop */}
			{/* biome-ignore lint: click closes panel */}
			<div className="fixed inset-0 z-40 bg-black/20" onClick={() => onOpenChange(false)} />

			{/* Slide-in panel */}
			<div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-card shadow-2xl">
				{/* Header */}
				<div className="flex items-start justify-between border-border border-b px-6 py-5">
					<div className="flex items-center gap-4">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/5 font-bold text-primary">
							{student.name.charAt(0).toUpperCase()}
						</div>
						<div>
							<p className="font-semibold text-foreground">{student.name}</p>
							<p className="text-muted-foreground text-sm">
								{student.rollNumber ?? student.email}
								{student.sectionName && <span className="ml-2 text-muted-foreground">· {student.sectionName}</span>}
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="rounded-xl p-2 text-muted-foreground transition-all hover:bg-muted hover:text-muted-foreground"
					>
						<XIcon weight="bold" className="size-5" />
					</button>
				</div>

				{/* Stats row */}
				<div className="grid grid-cols-3 divide-x divide-border border-border border-b bg-muted/50">
					<div className="px-5 py-3">
						<p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">Resumes</p>
						<p className="mt-0.5 font-bold text-2xl text-foreground">{student.resumes.length}</p>
					</div>
					<div className="px-5 py-3">
						<p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">Comments</p>
						<p className="mt-0.5 font-bold text-2xl text-foreground">
							{student.resumes.reduce((s, r) => s + r.commentCount, 0)}
						</p>
					</div>
					<div className="px-5 py-3">
						<p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">Avg Score</p>
						<p className="mt-0.5 font-bold text-2xl text-foreground">
							{(() => {
								const scored = student.resumes.filter((r) => r.evaluationScore !== null);
								if (scored.length === 0) return "—";
								const avg = scored.reduce((s, r) => s + r.evaluationScore!, 0) / scored.length;
								return avg.toFixed(1);
							})()}
						</p>
					</div>
				</div>

				{/* Tabs */}
				<div className="flex border-border border-b">
					{(["resumes", "timeline"] as const).map((tab) => (
						<button
							key={tab}
							type="button"
							onClick={() => setActiveTab(tab)}
							className={cn(
								"flex items-center gap-2 px-5 py-3 font-medium text-sm transition-all",
								activeTab === tab
									? "border-primary border-b-2 text-primary"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{tab === "resumes" ? (
								<FileTextIcon weight="duotone" className="size-4" />
							) : (
								<ClockCounterClockwiseIcon weight="duotone" className="size-4" />
							)}
							{tab === "resumes" ? "Resumes" : "Activity Timeline"}
						</button>
					))}
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6">
					{!student.resumeAppUserId ? (
						<div className="flex flex-col items-center justify-center py-16 text-center">
							<FileTextIcon weight="duotone" className="mb-3 size-10 text-muted-foreground" />
							<p className="font-semibold text-muted-foreground">Student hasn't registered yet</p>
							<p className="mt-1 text-muted-foreground text-sm">
								This student hasn't created an account on the resume platform.
							</p>
						</div>
					) : isLoading ? (
						<div className="space-y-3">
							{[...Array(3)].map((_, i) => (
								<div key={i} className="rounded-2xl border border-border p-5">
									<Skeleton className="mb-2 h-5 w-40" />
									<Skeleton className="h-4 w-24" />
								</div>
							))}
						</div>
					) : activeTab === "resumes" ? (
						<div className="space-y-3">
							{(detail?.resumes ?? []).length === 0 ? (
								<div className="rounded-2xl border border-border border-dashed p-10 text-center">
									<FileTextIcon weight="duotone" className="mx-auto mb-3 size-8 text-muted-foreground" />
									<p className="font-medium text-muted-foreground text-sm">No resumes created yet</p>
								</div>
							) : (
								(detail?.resumes ?? []).map((resume) => {
									const statusBadge = getStatusBadgeClass(
										resume.isSubmitted && resume.evaluationScore === null
											? "submitted"
											: resume.evaluationScore !== null
												? "evaluated"
												: resume.comments.length > 0
													? "has_comments"
													: "not_reviewed",
									);
									const isExpanded = expandedResumeId === resume.id;

									return (
										<div key={resume.id} className="overflow-hidden rounded-2xl border border-border">
											{/* Resume header row */}
											<div className="flex items-center gap-3 bg-card px-5 py-4">
												<div className="min-w-0 flex-1">
													<p className="truncate font-semibold text-foreground">{resume.name}</p>
													<p className="text-muted-foreground text-xs">
														Updated {new Date(resume.updatedAt).toLocaleDateString()}
													</p>
												</div>

												<div className="flex shrink-0 items-center gap-2">
													{resume.evaluationScore !== null && (
														<span
															className={cn(
																"rounded-full px-2.5 py-0.5 font-medium text-xs",
																getEvaluationBadgeClass(resume.evaluationScore),
															)}
														>
															{resume.evaluationScore.toFixed(1)}/5
														</span>
													)}
													<span
														className={cn(
															"rounded-full px-2.5 py-0.5 font-medium text-xs",
															statusBadge.bg,
															statusBadge.text,
														)}
													>
														{statusBadge.label}
													</span>

													{/* Download */}
													<button
														type="button"
														disabled={isDownloading}
														onClick={() => void download(resume.id, student.rollNumber, student.name)}
														className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary disabled:opacity-50"
														title="Download as PDF"
													>
														<DownloadSimpleIcon weight="duotone" className="size-4" />
													</button>

													{/* View */}
													<Link
														to="/builder/$resumeId"
														params={{ resumeId: resume.id }}
														target="_blank"
														rel="noreferrer"
														className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-all hover:bg-primary/5 hover:text-primary"
														title="Open resume"
													>
														<ArrowSquareOutIcon weight="duotone" className="size-4" />
													</Link>

													{/* Toggle comments */}
													<button
														type="button"
														onClick={() => setExpandedResumeId(isExpanded ? null : resume.id)}
														className={cn(
															"flex h-8 w-8 items-center justify-center rounded-xl transition-all",
															isExpanded
																? "bg-primary/10 text-primary"
																: "bg-muted text-muted-foreground hover:bg-primary/5 hover:text-primary",
														)}
														title="View / add comments"
													>
														<ChatDotsIcon weight="duotone" className="size-4" />
													</button>
												</div>
											</div>

											{/* Comments thread — expanded */}
											{isExpanded && (
												<div className="border-border border-t bg-muted/50 px-5 pt-3 pb-4">
													<p className="mb-3 font-semibold text-muted-foreground text-xs uppercase tracking-widest">
														Comments ({resume.comments.length})
													</p>

													{resume.comments.length === 0 ? (
														<p className="mb-3 text-center text-muted-foreground text-sm">No comments yet</p>
													) : (
														<div className="mb-3 space-y-2">
															{resume.comments.map((comment) => (
																<div key={comment.id} className="rounded-xl bg-card p-3 shadow-sm">
																	<p className="text-foreground text-sm">{comment.content}</p>
																	<p className="mt-1 text-muted-foreground text-xs">
																		{new Date(comment.createdAt).toLocaleDateString()} ·{" "}
																		{comment.status === "RESOLVED" ? (
																			<span className="text-emerald-600">Resolved</span>
																		) : (
																			"Open"
																		)}
																	</p>
																</div>
															))}
														</div>
													)}

													{/* Add comment */}
													<div className="flex gap-2">
														<input
															type="text"
															placeholder="Add a comment..."
															value={commentInputs[resume.id] ?? ""}
															onChange={(e) => setCommentInputs((prev) => ({ ...prev, [resume.id]: e.target.value }))}
															onKeyDown={(e) => {
																if (e.key === "Enter" && !e.shiftKey) {
																	e.preventDefault();
																	const content = commentInputs[resume.id]?.trim();
																	if (!content) return;
																	addCommentMutation.mutate({
																		resumeId: resume.id,
																		studentId: student.engLabsId,
																		tenantId,
																		content,
																	});
																}
															}}
															className="h-9 flex-1 rounded-xl border-0 bg-card px-3 text-sm outline-none ring-1 ring-border transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-primary"
														/>
														<button
															type="button"
															disabled={!commentInputs[resume.id]?.trim() || addCommentMutation.isPending}
															onClick={() => {
																const content = commentInputs[resume.id]?.trim();
																if (!content) return;
																addCommentMutation.mutate({
																	resumeId: resume.id,
																	studentId: student.engLabsId,
																	tenantId,
																	content,
																});
															}}
															className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition-all hover:bg-primary/90 disabled:opacity-50"
														>
															<PaperPlaneTiltIcon weight="duotone" className="size-4" />
														</button>
													</div>
												</div>
											)}
										</div>
									);
								})
							)}
						</div>
					) : (
						/* Timeline tab */
						<StudentTimeline entries={(detail?.resumes ?? []).flatMap((r) => r.history)} studentName={student.name} />
					)}
				</div>
			</div>
		</>
	);
}
