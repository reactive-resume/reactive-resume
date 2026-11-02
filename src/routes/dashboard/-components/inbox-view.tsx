import { t } from "@lingui/core/macro";
import { ArrowClockwiseIcon, ArrowRightIcon, ClockIcon, TrayIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "@/utils/style";
import { QUEUE_STAGES, reviewStageLabel, STAGES_FOR_SCOPE } from "./review-status";
import type { StudentWithResumes } from "./student-resume-table";

type InboxGroup = {
	id: string;
	label: string;
	description: string;
	iconBg: string;
	iconColor: string;
	icon: React.ReactNode;
	items: InboxItem[];
};

type InboxItem = {
	resumeId: string;
	resumeName: string;
	updatedAt: Date;
	reviewStatus: string;
	evaluationScore: number | null;
	commentCount: number;
	student: {
		engLabsId: string;
		name: string;
		email: string;
		rollNumber: string | null;
		sectionName: string | null;
	};
};

type InboxViewProps = {
	students: StudentWithResumes[];
	scope: "faculty" | "po";
	onReview?: (resumeId: string, engLabsStudentId: string) => void;
};

/** One line telling the reviewer why a stage is in their queue and who it is waiting on. */
function stageDescription(stage: string, scope: "faculty" | "po"): string {
	switch (stage) {
		case "SUBMITTED_TO_FACULTY":
			return scope === "faculty"
				? t`Submitted by students, waiting for your review`
				: t`Submitted by students, also waiting on their faculty`;
		case "FACULTY_REVISION_REQUESTED":
			return t`You asked for changes; waiting on the student`;
		case "FACULTY_VERIFIED":
			return t`Verified by faculty, not yet sent to the Placement Officer`;
		case "FINALIZED_BY_FACULTY":
			return t`Finalised by faculty, ready to go to the Placement Officer`;
		case "SUBMITTED_TO_PO":
			return t`Sent on by faculty, awaiting the Placement Officer`;
		case "RESUBMITTED_TO_PO":
			return t`Resubmitted after Placement Officer feedback`;
		case "PO_REVISION_REQUESTED":
			return t`The Placement Officer asked for changes; waiting on the student`;
		case "PO_VERIFIED":
			return t`Verified by the Placement Officer`;
		case "APPROVED":
			return t`Approved and ready for placement`;
		case "DRAFT":
			return t`Started but never submitted — waiting on the student, not on you`;
		default:
			return "";
	}
}

/** Colour for a stage's icon tile: amber where someone is being waited on, green once settled. */
function stageTone(stage: string): { bg: string; text: string } {
	if (stage === "APPROVED" || stage === "PO_VERIFIED" || stage === "FACULTY_VERIFIED") {
		return { bg: "bg-emerald-50", text: "text-emerald-600" };
	}
	if (stage.includes("REVISION_REQUESTED")) return { bg: "bg-amber-50", text: "text-amber-600" };
	if (stage === "DRAFT") return { bg: "bg-muted", text: "text-muted-foreground" };
	if (stage === "SUBMITTED_TO_FACULTY") return { bg: "bg-rose-50", text: "text-rose-600" };
	return { bg: "bg-orange-50", text: "text-orange-600" };
}

export function timeAgo(date: Date): string {
	const now = Date.now();
	const diff = now - new Date(date).getTime();
	const minutes = Math.floor(diff / 60_000);
	const hours = Math.floor(diff / 3_600_000);
	const days = Math.floor(diff / 86_400_000);

	if (minutes < 1) return t`just now`;
	if (minutes < 60) return t`${minutes}m ago`;
	if (hours < 24) return t`${hours}h ago`;
	if (days === 1) return t`yesterday`;
	return t`${days}d ago`;
}

export function InboxView({ students, scope, onReview }: InboxViewProps) {
	// Build flat list of inbox items per relevant status
	const allItems: InboxItem[] = students.flatMap((student) =>
		student.resumes.map((resume) => ({
			resumeId: resume.id,
			resumeName: resume.name,
			updatedAt: resume.updatedAt,
			reviewStatus: resume.reviewStatus ?? "DRAFT",
			evaluationScore: resume.evaluationScore,
			commentCount: resume.commentCount,
			student: {
				engLabsId: student.engLabsId,
				name: student.name,
				email: student.email,
				rollNumber: student.rollNumber,
				sectionName: student.sectionName,
			},
		})),
	);

	// Oldest first: a submission nobody has picked up is the most urgent thing in the queue, and
	// burying it under today's arrivals is how students end up waiting weeks.
	const sorted = [...allItems].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());

	// Stages this role acts on come first; the rest follow so nothing is unreachable. Only stages
	// actually present are offered, so every chip returns something.
	const present = new Set(sorted.map((i) => i.reviewStatus));
	const ownStages = STAGES_FOR_SCOPE[scope].filter((s) => present.has(s));
	const otherStages = QUEUE_STAGES.filter((s) => present.has(s) && !ownStages.includes(s));
	const draftCount = sorted.filter((i) => i.reviewStatus === "DRAFT").length;

	const [stageFilter, setStageFilter] = useState<"all" | string>("all");

	const visible =
		stageFilter === "all"
			? // "All" means everything waiting on a person, which is why DRAFT is not in it: those are
				// waiting on the student. It stays selectable as its own chip.
				sorted.filter((i) => i.reviewStatus !== "DRAFT")
			: sorted.filter((i) => i.reviewStatus === stageFilter);

	const groups: InboxGroup[] = [...ownStages, ...otherStages, ...(draftCount > 0 ? (["DRAFT"] as const) : [])]
		.map((stage) => ({
			id: stage,
			label: reviewStageLabel(stage),
			description: stageDescription(stage, scope),
			iconBg: stageTone(stage).bg,
			iconColor: stageTone(stage).text,
			icon:
				stage === "DRAFT" ? (
					<ClockIcon weight="duotone" className="size-5" />
				) : stage.includes("RESUBMITTED") ? (
					<ArrowClockwiseIcon weight="duotone" className="size-5" />
				) : (
					<TrayIcon weight="duotone" className="size-5" />
				),
			items: visible.filter((i) => i.reviewStatus === stage),
		}))
		.filter((g) => g.items.length > 0);

	const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);

	const chips: { id: string; label: string; count: number }[] = [
		{ id: "all", label: t`All`, count: sorted.filter((i) => i.reviewStatus !== "DRAFT").length },
		...[...ownStages, ...otherStages].map((s) => ({
			id: s,
			label: reviewStageLabel(s),
			count: sorted.filter((i) => i.reviewStatus === s).length,
		})),
		...(draftCount > 0 ? [{ id: "DRAFT", label: reviewStageLabel("DRAFT"), count: draftCount }] : []),
	];

	const filterBar = (
		<div className="flex flex-wrap gap-1.5">
			{chips.map((chip) => (
				<button
					key={chip.id}
					type="button"
					onClick={() => setStageFilter(chip.id)}
					className={cn(
						"rounded-xl px-3 py-2 font-semibold text-xs transition-all active:scale-[0.97]",
						stageFilter === chip.id
							? "bg-primary text-white shadow-sm"
							: "bg-muted text-muted-foreground hover:bg-border",
					)}
				>
					{chip.label}
					<span className="ml-1.5 opacity-60">{chip.count}</span>
				</button>
			))}
		</div>
	);

	if (totalCount === 0) {
		return (
			<div className="space-y-5">
				{chips.length > 1 && filterBar}
				<div className="flex flex-col items-center justify-center rounded-2xl border border-border border-dashed bg-muted/50 py-16 text-center">
					<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
						<TrayIcon weight="duotone" className="size-7 text-muted-foreground" />
					</div>
					<p className="font-bold text-base text-foreground">{t`Nothing here`}</p>
					<p className="mt-1 max-w-xs text-muted-foreground text-sm">
						{stageFilter === "all"
							? scope === "faculty"
								? t`No student submissions are waiting for your review.`
								: t`No resumes are pending your action.`
							: t`No resumes at this stage. Pick another filter to see the rest.`}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{filterBar}
			{groups
				.filter((g) => g.items.length > 0)
				.map((group) => (
					<div key={group.id} className="space-y-3">
						{/* Group Header */}
						<div className="flex items-center gap-3">
							<div
								className={cn(
									"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
									group.iconBg,
									group.iconColor,
								)}
							>
								{group.icon}
							</div>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="font-bold text-foreground text-sm">{group.label}</span>
									<span className="rounded-full bg-foreground px-2 py-0.5 font-bold text-[10px] text-background">
										{group.items.length}
									</span>
								</div>
								<p className="text-muted-foreground text-xs">{group.description}</p>
							</div>
						</div>

						{/* Items */}
						<div className="space-y-2">
							{group.items.map((item) => (
								<InboxCard key={item.resumeId} item={item} onReview={onReview} />
							))}
						</div>
					</div>
				))}
		</div>
	);
}

function InboxCard({
	item,
	onReview,
}: {
	item: InboxItem;
	onReview?: (resumeId: string, engLabsStudentId: string) => void;
}) {
	const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
		SUBMITTED_TO_FACULTY: { bg: "bg-blue-50", text: "text-blue-700", label: t`Submitted` },
		FINALIZED_BY_FACULTY: { bg: "bg-primary/5", text: "text-primary", label: t`Faculty Finalized` },
		SUBMITTED_TO_PO: { bg: "bg-orange-50", text: "text-orange-700", label: t`Submitted to PO` },
		RESUBMITTED_TO_PO: { bg: "bg-amber-50", text: "text-amber-700", label: t`Resubmitted` },
	};
	const badge = statusConfig[item.reviewStatus] ?? {
		bg: "bg-muted",
		text: "text-muted-foreground",
		label: item.reviewStatus,
	};

	return (
		<div className="flex items-center gap-4 rounded-2xl bg-card px-5 py-4 shadow-sm transition-all hover:shadow-md">
			{/* Student avatar */}
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/5 font-bold text-primary text-sm">
				{item.student.name.charAt(0).toUpperCase()}
			</div>

			{/* Main content */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate font-semibold text-foreground text-sm">{item.student.name}</span>
					{item.student.rollNumber && (
						<span className="shrink-0 text-muted-foreground text-xs">· {item.student.rollNumber}</span>
					)}
				</div>
				<div className="mt-0.5 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
					<span className="truncate">{item.resumeName}</span>
					{item.student.sectionName && (
						<>
							<span className="text-muted-foreground">·</span>
							<span className="truncate">{item.student.sectionName}</span>
						</>
					)}
				</div>
			</div>

			{/* Meta */}
			<div className="flex shrink-0 items-center gap-3">
				{/* Timestamp */}
				<div className="hidden items-center gap-1 text-muted-foreground text-xs sm:flex">
					<ClockIcon weight="duotone" className="size-3.5" />
					<span>{timeAgo(item.updatedAt)}</span>
				</div>

				{/* Score if evaluated */}
				{item.evaluationScore !== null && (
					<span className="rounded-full bg-emerald-50 px-2.5 py-0.5 font-medium text-emerald-700 text-xs">
						{item.evaluationScore.toFixed(1)}/5
					</span>
				)}

				{/* Status badge */}
				<span className={cn("rounded-full px-2.5 py-0.5 font-medium text-xs", badge.bg, badge.text)}>
					{badge.label}
				</span>

				{/* Review CTA */}
				{onReview && (
					<button
						type="button"
						onClick={() => onReview(item.resumeId, item.student.engLabsId)}
						className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 font-semibold text-white text-xs transition-all hover:bg-primary/90 active:scale-[0.97]"
					>
						{t`Review`}
						<ArrowRightIcon weight="bold" className="size-3" />
					</button>
				)}
			</div>
		</div>
	);
}
