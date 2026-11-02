import { t } from "@lingui/core/macro";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { severityLabel } from "@/components/resume/review-anchors";
import { orpc } from "@/integrations/orpc/client";
import { cn } from "@/utils/style";
import { uiSurface } from "@/utils/ui-tokens";
import { timeAgo } from "./inbox-view";
import { REVIEWER_STAGE_BUCKETS } from "./review-status";
import { getStatusBadgeClass } from "./score-helpers";
import type { StudentWithResumes } from "./student-resume-table";

type ResumeEntry = StudentWithResumes["resumes"][number];

/** review: the student acted (submitted, resubmitted or marked a comment fixed); student: not acted on yet; done: decided. */
type Bucket = "review" | "student" | "done";

type Scope = "faculty" | "po" | "admin";

const stageOf = (scope: Scope) => REVIEWER_STAGE_BUCKETS[scope === "faculty" ? "faculty" : "po"];

/** Where a resume stands for this reviewer. Action first, like a code-review inbox; null = nothing to track. */
function bucketOf(
	status: string,
	mine: ResumeEntry["myComments"],
	stage: (typeof REVIEWER_STAGE_BUCKETS)["po"],
): Bucket | null {
	if (status === "APPROVED") return "done";
	if (stage.waiting.includes(status) || mine?.ADDRESSED) return "review";
	if (stage.sentBack.includes(status) || mine?.OPEN) return "student";
	if (stage.verified.includes(status) || mine) return "done";
	return null;
}

/** Resumes that reached this reviewer's stage, and how many of those already have their decision. */
export function reviewRate(students: StudentWithResumes[], scope: Scope) {
	const stage = stageOf(scope);
	const statuses = students.flatMap((s) => s.resumes.map((r) => r.reviewStatus ?? "DRAFT"));
	const reviewed = statuses.filter(
		(s) => s === "APPROVED" || stage.sentBack.includes(s) || stage.verified.includes(s),
	).length;
	return { reviewed, total: reviewed + statuses.filter((s) => stage.waiting.includes(s)).length };
}

type Props = {
	students: StudentWithResumes[];
	scope: Scope;
	reviewerId: string | null;
	onReview: (resumeId: string, engLabsStudentId: string) => void;
};

/** Overview: the reviewer's students, their review status and the reviewer's own comments, one click from the review. */
export function ReviewTracker({ students, scope, reviewerId, onReview }: Props) {
	const stage = stageOf(scope);
	const [filter, setFilter] = useState<Bucket | "all">("all");
	const [open, setOpen] = useState<string | null>(null);

	// "done" (verified / approved / comments all settled) only shows under All.
	const buckets: { id: Bucket; label: string }[] = [
		{ id: "review", label: t`Needs your review` },
		{ id: "student", label: t`Not acted on yet` },
	];
	const order: Bucket[] = ["review", "student", "done"];

	const rows = students
		.flatMap((student) =>
			student.resumes.flatMap((resume) => {
				const counts = resume.myComments;
				// No counted comment (e.g. only an old status) is not "comments that are all settled".
				const mine = counts && counts.OPEN + counts.ADDRESSED + counts.RESOLVED > 0 ? counts : null;
				const bucket = bucketOf(resume.reviewStatus ?? "DRAFT", mine, stage);
				return bucket ? [{ student, resume, mine, bucket }] : [];
			}),
		)
		.sort(
			(a, b) =>
				order.indexOf(a.bucket) - order.indexOf(b.bucket) ||
				new Date(b.resume.updatedAt).getTime() - new Date(a.resume.updatedAt).getTime(),
		);
	const shown = filter === "all" ? rows : rows.filter((row) => row.bucket === filter);

	return (
		<section className={cn(uiSurface.card, "space-y-4 p-5")}>
			<h3 className="font-semibold text-lg">{t`My reviews`}</h3>

			<div className="flex flex-wrap gap-2">
				{[{ id: "all" as const, label: t`All` }, ...buckets].map((b) => (
					<button
						key={b.id}
						type="button"
						onClick={() => setFilter(b.id)}
						className={cn(
							"rounded-full border px-3 py-1 text-sm",
							filter === b.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted",
						)}
					>
						{b.label} · {b.id === "all" ? rows.length : rows.filter((row) => row.bucket === b.id).length}
					</button>
				))}
			</div>

			{shown.length === 0 ? (
				<p className="py-6 text-center text-muted-foreground text-sm">{t`Nothing here right now.`}</p>
			) : (
				// ponytail: one scroll box instead of paging; a PO's tenant-wide list can be long.
				<ul className="max-h-[28rem] divide-y divide-border overflow-y-auto rounded-xl border border-border">
					{shown.map(({ student, resume, mine }) => {
						const status = getStatusBadgeClass(resume.reviewStatus ?? "DRAFT");
						const expanded = open === resume.id;
						return (
							<li key={resume.id}>
								<div className="flex items-center gap-3 px-3 py-2.5">
									<button
										type="button"
										onClick={() => setOpen(expanded ? null : resume.id)}
										aria-expanded={expanded}
										className="flex min-w-0 flex-1 items-center gap-3 text-start"
									>
										<CaretRightIcon className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-90")} />
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium text-sm">{student.name}</span>
											<span className="block truncate text-muted-foreground text-xs">
												{[student.rollNumber, student.sectionName].filter(Boolean).join(" · ")}
											</span>
										</span>
										<span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs", status.bg, status.text)}>
											{status.label}
										</span>
										<span className="hidden w-52 shrink-0 text-muted-foreground text-xs md:block">
											{mine
												? t`${mine.OPEN} open · ${mine.ADDRESSED} addressed · ${mine.RESOLVED} resolved`
												: t`No comments from you`}
										</span>
										<span className="hidden w-20 shrink-0 text-muted-foreground text-xs lg:block">
											{timeAgo(resume.updatedAt)}
										</span>
									</button>
									<button
										type="button"
										onClick={() => onReview(resume.id, student.engLabsId)}
										className="shrink-0 rounded-lg border border-border px-2.5 py-1 font-medium text-xs hover:bg-muted"
									>
										{t`Open review`}
									</button>
								</div>
								{expanded && (
									<MyCommentList
										resumeId={resume.id}
										reviewerId={reviewerId}
										onOpen={() => onReview(resume.id, student.engLabsId)}
									/>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function MyCommentList({
	resumeId,
	reviewerId,
	onOpen,
}: {
	resumeId: string;
	reviewerId: string | null;
	onOpen: () => void;
}) {
	const { data, isLoading } = useQuery(orpc.resume.comments.list.queryOptions({ input: { resumeId } }));
	const mine = (data ?? []).filter((c) => c.parentId === null && c.authorId === reviewerId);

	if (isLoading) return <p className="px-10 pb-3 text-muted-foreground text-xs">{t`Loading…`}</p>;
	if (mine.length === 0)
		return <p className="px-10 pb-3 text-muted-foreground text-xs">{t`No comments from you yet.`}</p>;

	return (
		<ul className="space-y-1.5 px-10 pb-3">
			{mine.map((c) => (
				<li key={c.id}>
					<button
						type="button"
						onClick={onOpen}
						className="w-full rounded-lg bg-muted/50 p-2.5 text-start hover:bg-muted"
					>
						<span className="flex flex-wrap items-center gap-2 text-xs">
							<span className="font-medium">
								{c.status === "RESOLVED" ? t`Resolved` : c.status === "ADDRESSED" ? t`Addressed` : t`Open`}
							</span>
							{c.severity && <span className="text-muted-foreground">{t`${severityLabel(c.severity)} severity`}</span>}
							<span className="text-muted-foreground">{timeAgo(c.createdAt)}</span>
						</span>
						{c.anchor?.quote && (
							<span className="mt-1 block truncate text-muted-foreground text-xs italic">“{c.anchor.quote.exact}”</span>
						)}
						<span className="mt-0.5 line-clamp-2 block text-sm">{c.content}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
