import { plural, t } from "@lingui/core/macro";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	BuildingsIcon,
	ChartBarIcon,
	CheckCircleIcon,
	FunnelSimpleIcon,
	ListChecksIcon,
	MagnifyingGlassIcon,
	TrayIcon,
	UsersIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AdminAtsStats } from "@/components/ats/admin-ats-stats";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatStrip } from "@/components/ui/stat";
import { orpc } from "@/integrations/orpc/client";
import { dlog } from "@/utils/debug";
import { cn } from "@/utils/style";
import { uiControl, uiSurface } from "@/utils/ui-tokens";
import { ChecklistCreator } from "./checklist-creator";
import { ChecklistsTab } from "./checklists-tab";
import { DashboardHeader } from "./header";
import { InboxView } from "./inbox-view";
import type { OrgUnitFilterValue } from "./org-unit-filter";
import { OrgUnitFilter } from "./org-unit-filter";
import { ResumeStatusPanel, ScoreSpreadPanel } from "./overview-panels";
import { POSectionCardActions } from "./po-section-card-actions";
import { POSectionFeedbackBanner } from "./po-section-feedback-banner";
import { POSectionReviewDialog } from "./po-section-review-dialog";
import { RecentActivity } from "./recent-activity";
import { ReviewTracker, reviewRate } from "./review-tracker";
import { SectionIntelligence } from "./section-intelligence";
import { StudentDetailPanel } from "./student-detail-panel";
import type { StudentWithResumes } from "./student-resume-table";
import { StudentResumeTable } from "./student-resume-table";

export type DashboardTab = "overview" | "inbox" | "sections" | "students" | "checklists";

type SectionMetricsViewProps = {
	scope: "faculty" | "po" | "admin";
	sectionIds: string[];
	tenantId: string;
	initialTab?: DashboardTab;
	initialFilter?: OrgUnitFilterValue;
	sectionId?: string;
};

export function SectionMetricsView({
	scope,
	sectionIds,
	tenantId,
	initialTab = "overview",
	initialFilter = {},
	sectionId,
}: SectionMetricsViewProps) {
	const navigate = useNavigate() as any;
	const activeTab = initialTab;
	const [filter, setFilter] = useState<OrgUnitFilterValue>(initialFilter);
	const queryClient = useQueryClient();

	useEffect(() => {
		setFilter(initialFilter);
	}, [initialFilter]);
	const [selectedStudent, setSelectedStudent] = useState<StudentWithResumes | null>(null);
	const [showChecklistCreator, setShowChecklistCreator] = useState(false);
	const [viewLevel, setViewLevel] = useState<string | null>(null);
	const [sectionsTabSearch, setSectionsTabSearch] = useState("");
	const [poReviewDialog, setPoReviewDialog] = useState<{
		sectionId: string;
		sectionName: string;
		resumes: Array<{ id: string; studentId: string }>;
	} | null>(null);

	const queryInput = {
		sectionIds,
		tenantId,
		scope: scope === "admin" ? "po" : scope,
		activeUnitId: filter.unitId,
	};

	const {
		data: dashboard,
		isLoading,
		isPending,
		isFetching,
		isSuccess,
		isError,
		fetchStatus,
		error,
	} = useQuery(orpc.resume.dashboard.sections.queryOptions({ input: queryInput }));

	// Log every render so we can correlate render passes with query state transitions. The same
	// component renders on SSR and on each client re-render after a query state change, so this
	// gives a per-render snapshot to compare against the handler logs above.
	dlog("section-metrics-view", "render", {
		scope,
		activeTab,
		sectionIds,
		tenantId,
		activeUnitId: filter.unitId,
		query: {
			isLoading,
			isPending,
			isFetching,
			isSuccess,
			isError,
			fetchStatus,
			hasData: dashboard !== undefined,
			hasError: error !== null,
			errorMessage: error?.message ?? null,
		},
	});

	const bulkUpdateMutation = useMutation({
		...orpc.resume.dashboard.bulkUpdateResumes.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.resume.dashboard.sections.queryOptions({ input: { sectionIds, tenantId, scope: scope as any } })
					.queryKey as any,
			});
		},
	});

	// ── Derived stats ──────────────────────────────────────────────────────────
	const stats = useMemo(() => {
		if (!dashboard)
			return { totalStudents: 0, totalResumes: 0, completionRate: 0, averageScore: null as number | null };
		return dashboard.aggregateStats;
	}, [dashboard]);

	const detailedStats = useMemo(() => {
		if (!dashboard) return { withResumes: 0, noResumes: 0, pendingReview: 0, evaluated: 0, submitted: 0 };
		const students = dashboard.students;
		const withResumes =
			dashboard.aggregateStats.withPrimaryResume ?? students.filter((s) => s.resumes.length > 0).length;
		const enrolled = dashboard.aggregateStats.enrolledInResumeBuilder ?? students.length;
		const noResumes = enrolled - withResumes;
		const pendingReview = students.filter((s) =>
			s.resumes.some((r) => r.isSubmitted && r.evaluationScore === null),
		).length;
		const evaluated = students.filter((s) => s.resumes.some((r) => r.evaluationScore !== null)).length;
		const submitted = students.filter((s) => s.resumes.some((r) => r.isSubmitted)).length;
		return { withResumes, noResumes, pendingReview, evaluated, submitted };
	}, [dashboard]);

	// ── Filter data (comes directly from server) ──────────────────────────────
	const filterPackages = dashboard?.packages ?? [];
	const filterUnitTypes = dashboard?.unitTypes ?? [];
	const filterAllOrgUnits = dashboard?.allOrgUnits ?? [];

	// Students are already filtered server-side via activeUnitId
	const filteredStudents = dashboard?.students ?? [];

	const openReview = (resumeId: string, engLabsStudentId: string) => {
		navigate({
			to: "/dashboard/review/$resumeId",
			params: { resumeId },
			search: {
				engLabsStudentId,
				tenantId,
				packageId: filter.packageId,
				unitType: filter.unitType,
				unitId: filter.unitId,
				scope: (scope === "admin" ? "po" : scope) as "faculty" | "po",
			},
		});
	};

	// ── Section drill-down derived state ─────────────────────────────────────
	const activeSection = useMemo(
		() => (sectionId ? dashboard?.sections.find((s) => s.id === sectionId) : undefined),
		[dashboard?.sections, sectionId],
	);
	const isSectionDetail = activeTab === "sections" && !!sectionId;

	const sectionsTabPackageOptions = useMemo(() => {
		if (filterPackages.length > 0) {
			return filterPackages.map((p) => ({ value: p.id, label: p.name }));
		}
		const byId = new Map<string, string>();
		for (const s of dashboard?.sections ?? []) {
			if (s.packageId && s.packageName) byId.set(s.packageId, s.packageName);
		}
		return [...byId.entries()].map(([value, label]) => ({ value, label }));
	}, [filterPackages, dashboard?.sections]);

	const sectionsTabFilteredRows = useMemo(() => {
		const rows = dashboard?.sections ?? [];
		return rows.filter((s) => {
			// Match on packageIds (real placement packages, resolved from enrolments), never on
			// packageId — that holds the parent org unit for most callers, so comparing it against a
			// package id from the dropdown never matched and emptied the list. A class whose learners
			// span two packages legitimately appears under both.
			if (filter.packageId && !((s as { packageIds?: string[] }).packageIds ?? []).includes(filter.packageId))
				return false;
			const level = viewLevel || (filterUnitTypes.includes("CLASS") ? "CLASS" : filterUnitTypes[0]);
			if (filterUnitTypes.length === 0) return true;
			return s.unitType === level;
		});
	}, [dashboard?.sections, filter.packageId, filterUnitTypes, viewLevel]);

	const sectionsTabDisplayRows = useMemo(() => {
		const q = sectionsTabSearch.trim().toLowerCase();
		if (!q) return sectionsTabFilteredRows;
		return sectionsTabFilteredRows.filter((unit) => {
			const name = unit.name.toLowerCase();
			const pkg = unit.packageName?.toLowerCase() ?? "";
			const ut = unit.unitType.toLowerCase();
			return name.includes(q) || pkg.includes(q) || ut.includes(q);
		});
	}, [sectionsTabFilteredRows, sectionsTabSearch]);

	// ── Header (title + icon) — driven by active tab and section drill-down ──
	const header = (() => {
		if (isSectionDetail) {
			return {
				title: activeSection?.name ?? t`Section`,
				icon: BuildingsIcon,
			};
		}
		switch (activeTab) {
			case "overview":
				return { title: t`Overview`, icon: ChartBarIcon };
			case "inbox":
				return { title: t`Inbox`, icon: TrayIcon };
			case "sections":
				return { title: t`Sections`, icon: BuildingsIcon };
			case "students":
				return { title: t`Students`, icon: UsersIcon };
			case "checklists":
				return { title: t`Checklists`, icon: ListChecksIcon };
		}
	})();

	// ── Error first, then loading. `isLoading` is `isPending && isFetching`, which is FALSE on the
	// server (no client fetch yet) — so without the explicit `!dashboard` guard, SSR would fall
	// through to the main render below and crash on `dashboard.aggregateStats` (line ~287). That
	// crash mid-stream is what was leaving the content area blank after SSO redirect: the sidebar
	// was already flushed, then the content render threw, breaking the stream.
	if (error) {
		dlog("section-metrics-view", "guard:error-branch", {
			errorName: error.name,
			errorMessage: error.message,
		});
		return (
			<div className={cn("flex flex-col items-center justify-center border-2 p-12", uiSurface.empty)}>
				<WarningIcon className="mb-4 size-12 text-amber-500 opacity-50" />
				<h3 className="font-bold text-foreground text-lg">{t`Unable to load dashboard data`}</h3>
				<p className="mt-2 max-w-md text-muted-foreground text-sm">
					{t`There was an error fetching student data. This might be due to missing database columns. Please ensure 'npm run db:push' has been executed.`}
				</p>
				<p className="mt-4 rounded-xl border border-border bg-muted p-2 font-mono text-muted-foreground text-xs">
					{error.message}
				</p>
			</div>
		);
	}

	if (isLoading || !dashboard) {
		dlog("section-metrics-view", "guard:loading-branch", {
			reason: isLoading ? "isLoading-true" : "data-undefined",
			isLoading,
			isPending,
			isFetching,
			fetchStatus,
		});
		return (
			<div className="space-y-6">
				<DashboardHeader icon={header.icon} title={header.title} />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					{[...Array(4)].map((_, i) => (
						<div key={i} className={cn(uiSurface.card, "p-6")}>
							<Skeleton className="mb-2 h-8 w-16" />
							<Skeleton className="h-4 w-24" />
						</div>
					))}
				</div>
			</div>
		);
	}

	dlog("section-metrics-view", "guard:main-branch", {
		studentsCount: dashboard.students.length,
		sectionsCount: dashboard.sections.length,
		packagesCount: dashboard.packages.length,
		aggregate: dashboard.aggregateStats,
	});

	const hasStudents = dashboard.students.length > 0;
	const review = reviewRate(filteredStudents, scope);
	const waiting = review.total - review.reviewed;
	const evaluationRate = detailedStats.withResumes > 0 ? (detailedStats.evaluated / detailedStats.withResumes) * 100 : 0;
	const overviewNote =
		waiting > 0
			? plural(waiting, { one: "# resume is waiting for your review.", other: "# resumes are waiting for your review." })
			: review.total > 0
				? t`You're all caught up.`
				: t`Nothing has been sent to you for review yet.`;

	return (
		<div className="space-y-6">
			<DashboardHeader
				icon={header.icon}
				title={header.title}
				description={activeTab === "overview" ? overviewNote : undefined}
			>
				{activeTab === "overview" && waiting > 0 && (
					<Button
						type="button"
						className="rounded-xl"
						onClick={() => navigate({ search: (prev: any) => ({ ...prev, tab: "inbox" }) })}
					>
						<TrayIcon weight="duotone" className="size-4" />
						{t`Open inbox`}
					</Button>
				)}
				{activeTab === "checklists" && (
					<Button type="button" onClick={() => setShowChecklistCreator(true)} className="rounded-xl">
						<ListChecksIcon weight="duotone" className="size-4" />
						{t`New Checklist`}
					</Button>
				)}
			</DashboardHeader>

			{/* ══════════════════ OVERVIEW TAB ══════════════════ */}
			{activeTab === "overview" && (
				<div className="space-y-6">
					{/* Filter — above metrics */}
					{filterAllOrgUnits.length > 0 && (
						<div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
							<OrgUnitFilter
								allOrgUnits={filterAllOrgUnits}
								value={filter}
								onChange={(next) => {
									setFilter(next);
									navigate({ search: (prev: any) => ({ ...prev, ...next }) as any });
								}}
							/>
						</div>
					)}

					{/* ── Key metrics ── */}
					<StatStrip>
						<Stat
							label={t`Total students`}
							value={stats.totalStudents}
							tooltip="Learners in your placement scope who also have a resume builder (Polymath) account — eng-labs and resume DB joined by email."
						/>
						<Stat
							label={t`Evaluation rate`}
							value={`${Math.round(evaluationRate)}%`}
							progress={evaluationRate}
							hint={t`${detailedStats.evaluated} of ${detailedStats.withResumes} evaluated`}
							tooltip="Percentage of resumes evaluated from the total submitted resumes"
						/>
						<Stat
							label={t`Review rate`}
							value={review.total > 0 ? `${Math.round((review.reviewed / review.total) * 100)}%` : null}
							progress={review.total > 0 ? (review.reviewed / review.total) * 100 : null}
							hint={review.total > 0 ? t`${review.reviewed} of ${review.total} reviewed` : t`Nothing sent to you yet`}
							tooltip={t`Resumes sent to you for review that already have your decision: sent back, verified or approved. Counts resumes, from their review status.`}
						/>
						<Stat
							label={t`Average score`}
							value={
								stats.averageScore === null ? null : (
									<>
										{stats.averageScore.toFixed(1)}
										<span className="ml-0.5 font-medium text-base text-muted-foreground">/5</span>
									</>
								)
							}
							hint={stats.averageScore === null ? t`No evaluations yet` : undefined}
						/>
						{/* ats.adminStats is tenant-wide by design (it only rejects learners), so this
						    count is not confined to a faculty member's own students. Restricted to
						    PO/admin for the same reason AtsImprovementsSection below is. */}
						{scope !== "faculty" && <AtsChecksCard />}
					</StatStrip>

					{/* ── Where resumes stand + scores ── */}
					<div className="grid gap-6 lg:grid-cols-2">
						<ResumeStatusPanel students={filteredStudents} />
						<ScoreSpreadPanel students={filteredStudents} />
					</div>

					{/* Empty state */}
					{!hasStudents && (
						<div className={cn("flex flex-col items-center justify-center py-12", uiSurface.empty)}>
							<WarningIcon weight="duotone" className="mb-3 size-10 text-amber-400" />
							<p className="font-semibold text-foreground">{t`No student data found`}</p>
							<p className="mt-1 max-w-xs text-muted-foreground text-sm">
								No students found for the assigned sections. Ensure eng-labs is configured and students are enrolled.
							</p>
						</div>
					)}

					{/* Section Intelligence — PO / Admin only */}
					{scope !== "faculty" && dashboard && (
						<SectionIntelligence
							sections={dashboard.sections}
							students={filteredStudents}
							allOrgUnits={dashboard.allOrgUnits}
							onNavigateToTab={(tab, extraSearch) => {
								navigate({
									search: (prev: any) => ({ ...prev, tab, ...extraSearch }),
								});
							}}
						/>
					)}

					{/* ATS Score Improvements (admin/PO only) */}
					{scope !== "faculty" && <AtsImprovementsSection />}

					{/* Recent Activity */}
					{dashboard?.recentActivity && (
						<RecentActivity recentEvaluations={dashboard.recentActivity.recentEvaluations} />
					)}

					{hasStudents && (
						<ReviewTracker
							students={filteredStudents}
							scope={scope}
							reviewerId={dashboard.reviewerId}
							onReview={openReview}
						/>
					)}
				</div>
			)}

			{/* ══════════════════ INBOX TAB ══════════════════ */}
			{/* Every student goes in; the inbox decides which stages to show and lets the reviewer
			    filter. Pre-filtering to a fixed pair of stages here is what left the Placement
			    Officer's inbox empty while hundreds of submissions sat waiting. */}
			{activeTab === "inbox" && (
				<InboxView scope={scope === "admin" ? "po" : scope} students={filteredStudents} onReview={openReview} />
			)}

			{/* ══════════════════ SECTION DETAIL (drill-down) ══════════════════ */}
			{activeTab === "sections" && sectionId && (
				<SectionStudentsPage
					section={activeSection}
					students={filteredStudents.filter((s) => s.sectionId === sectionId)}
					onBack={() => {
						navigate({
							search: (prev: any) => ({ ...prev, sectionId: undefined }),
						});
					}}
					onReview={(resumeId, engLabsStudentId) => {
						navigate({
							to: "/dashboard/review/$resumeId",
							params: { resumeId },
							search: {
								engLabsStudentId,
								tenantId,
								packageId: filter.packageId,
								unitType: filter.unitType,
								unitId: filter.unitId,
								sectionId,
								scope: (scope === "admin" ? "po" : scope) as "faculty" | "po",
							},
						});
					}}
					onStudentClick={(student) => setSelectedStudent(student)}
				/>
			)}

			{/* ══════════════════ SECTIONS TAB (grid) ══════════════════ */}
			{activeTab === "sections" && !sectionId && (
				<div className="space-y-6">
					{/* Package filter + search */}
					<div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
						<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
							{sectionsTabPackageOptions.length > 0 ? (
								<div className="flex flex-wrap items-center gap-3">
									<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
										<FunnelSimpleIcon weight="duotone" className="size-3.5" />
										<span className="font-medium">{t`Filters`}</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="font-medium text-muted-foreground text-xs">{t`Package`}</span>
										<Combobox
											options={sectionsTabPackageOptions}
											value={filter.packageId ?? null}
											placeholder={t`All packages`}
											clearable={true}
											buttonProps={{ className: uiControl.comboboxTrigger }}
											onValueChange={(v) => {
												const updatedFilter: OrgUnitFilterValue = {
													packageId: v ?? undefined,
													unitType: undefined,
													unitId: undefined,
												};
												setFilter(updatedFilter);
												navigate({
													search: (prev: any) => ({ ...prev, ...updatedFilter }) as any,
												});
											}}
										/>
									</div>
								</div>
							) : null}
							<div
								className={cn(
									"relative min-w-[200px] flex-1",
									sectionsTabPackageOptions.length > 0 ? "lg:max-w-md" : "w-full",
								)}
							>
								<MagnifyingGlassIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
								<input
									type="search"
									placeholder={t`Search sections by name, package, or type...`}
									value={sectionsTabSearch}
									onChange={(e) => setSectionsTabSearch(e.target.value)}
									className={uiControl.searchField}
									autoComplete="off"
								/>
							</div>
						</div>
					</div>

					{/* Level Selector */}
					{filterUnitTypes.length > 1 && (
						<div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
							<span className="font-bold text-muted-foreground text-sm uppercase tracking-wider">{t`View by`}:</span>
							<div className="flex gap-2">
								{filterUnitTypes.map((type) => (
									<button
										key={type}
										type="button"
										onClick={() => setViewLevel(type)}
										className={cn(
											"transition-[transform,colors] duration-200 active:scale-[0.97]",
											viewLevel === type || (!viewLevel && type === "CLASS")
												? uiControl.pillSelected
												: uiControl.pillIdle,
										)}
									>
										{type}
									</button>
								))}
							</div>
						</div>
					)}

					<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
						{sectionsTabDisplayRows.map((unit) => {
							const { stats } = unit;
							const totalResumes = stats.totalResumes;
							const verifiedResumes = stats.evaluatedResumes;

							const sectionStudents = dashboard?.students.filter((s) => s.sectionId === unit.id) || [];

							// Faculty: resumes eligible to submit to PO (FACULTY_VERIFIED or FINALIZED_BY_FACULTY for re-submission after PO feedback)
							const pendingResumesList = sectionStudents.flatMap((s) =>
								s.resumes
									.filter((r) => r.reviewStatus === "FACULTY_VERIFIED" || r.reviewStatus === "FINALIZED_BY_FACULTY")
									.map((r) => ({ id: r.id, studentId: s.engLabsId })),
							);

							// States that are "in PO hands" — faculty cannot submit or change these
							const PO_MANAGED = [
								"SUBMITTED_TO_PO",
								"PO_REVISION_REQUESTED",
								"RESUBMITTED_TO_PO",
								"PO_VERIFIED",
								"APPROVED",
							];

							// Resumes currently in PO-managed states
							const resumesInPOHands = sectionStudents.flatMap((s) =>
								s.resumes.filter((r) => PO_MANAGED.includes(r.reviewStatus ?? "")),
							);
							const isInPOHands = resumesInPOHands.length > 0;

							// PO: all resumes that are in any active PO-managed state (excluding APPROVED — those are done)
							const poSubmittedResumes = sectionStudents.flatMap((s) =>
								s.resumes
									.filter((r) => PO_MANAGED.includes(r.reviewStatus ?? "") && r.reviewStatus !== "APPROVED")
									.map((r) => ({ id: r.id, studentId: s.engLabsId })),
							);

							// Summary label for faculty when section is in PO hands
							const poHandsStatusLabel = (() => {
								if (resumesInPOHands.every((r) => r.reviewStatus === "APPROVED")) return "Approved";
								if (resumesInPOHands.some((r) => r.reviewStatus === "PO_REVISION_REQUESTED"))
									return "PO: Revision Requested";
								if (resumesInPOHands.some((r) => r.reviewStatus === "SUBMITTED_TO_PO")) return "Awaiting PO Review";
								return "With PO";
							})();

							return (
								<div
									key={unit.id}
									className={cn(
										uiSurface.card,
										"flex flex-col p-5 transition-[box-shadow] duration-200 hover:shadow-md",
									)}
								>
									<div className="mb-4 flex items-start justify-between gap-2">
										<div className="min-w-0 flex-1">
											<h3 className="line-clamp-1 font-bold text-foreground text-lg">{unit.name}</h3>
											{/* Department / stream, from the org-unit tree. packageName is only a fallback:
											    it carries a package name for unit-assigned faculty and a parent-unit name
											    for everyone else, so relying on it showed different things per role. */}
											{((unit as { parentName?: string | null }).parentName ?? unit.packageName) ? (
												<p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
													{(unit as { parentName?: string | null }).parentName ?? unit.packageName}
												</p>
											) : null}
										</div>
										<span className="shrink-0 rounded-lg bg-muted px-2 py-1 font-bold text-[10px] text-muted-foreground uppercase">
											{unit.unitType}
										</span>
									</div>

									<div className="mb-4 flex-1 space-y-3">
										<div className="flex justify-between text-xs">
											<span className="text-muted-foreground">{t`Verified Progress`}</span>
											<span className="font-bold text-foreground">
												{verifiedResumes} / {totalResumes}
											</span>
										</div>
										<div className="h-2 overflow-hidden rounded-full bg-muted">
											<div
												className="h-full bg-emerald-500 text-[8px] transition-all"
												style={{ width: `${totalResumes > 0 ? (verifiedResumes / totalResumes) * 100 : 0}%` }}
											/>
										</div>
										<div className="flex justify-between text-[10px] text-muted-foreground italic">
											<span>
												{t`Total Students`}: {stats.totalStudents}
											</span>
											{stats.averageScore && (
												<span>
													{t`Avg Score`}: {stats.averageScore.toFixed(1)}
												</span>
											)}
										</div>
									</div>

									{/* Review button */}
									<button
										type="button"
										onClick={() => {
											navigate({
												search: (prev: any) => ({ ...prev, tab: "sections", sectionId: unit.id }),
											});
										}}
										className={cn(uiControl.outlineButton, "mb-3 w-full py-2 font-semibold text-sm")}
									>
										<UsersIcon weight="duotone" className="size-4" />
										{t`Review Students`}
										<ArrowRightIcon weight="bold" className="size-3" />
									</button>

									{scope === "faculty" ? (
										<>
											{/* Show PO feedback banner if the section was returned with notes */}
											<POSectionFeedbackBanner sectionId={unit.id} tenantId={tenantId} />

											{isInPOHands ? (
												/* Read-only: section is currently with the PO — faculty cannot submit */
												<div className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-orange-200 bg-orange-50 py-2.5 font-bold text-orange-600 text-sm">
													<CheckCircleIcon weight="fill" className="size-4" />
													{poHandsStatusLabel}
												</div>
											) : (
												<button
													type="button"
													disabled={pendingResumesList.length === 0 || bulkUpdateMutation.isPending}
													onClick={() => {
														bulkUpdateMutation.mutate({
															resumes: pendingResumesList,
															tenantId,
															status: "SUBMITTED_TO_PO",
														});
													}}
													className={cn(
														"mt-2 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-sm shadow-sm transition-[transform,colors] duration-200 active:scale-[0.97]",
														pendingResumesList.length > 0
															? "bg-primary text-primary-foreground hover:bg-primary/90"
															: "cursor-not-allowed border border-border bg-muted text-muted-foreground",
													)}
												>
													{pendingResumesList.length > 0 ? t`Submit Section to PO` : t`Verify All Resumes First`}
												</button>
											)}
										</>
									) : (
										<POSectionCardActions
											sectionId={unit.id}
											sectionName={unit.name}
											tenantId={tenantId}
											stats={stats as any}
											poSubmittedResumes={poSubmittedResumes}
											sectionStudents={sectionStudents}
											onOpenReviewDialog={() =>
												setPoReviewDialog({
													sectionId: unit.id,
													sectionName: unit.name,
													resumes: poSubmittedResumes,
												})
											}
											isPending={bulkUpdateMutation.isPending}
										/>
									)}
								</div>
							);
						})}
					</div>

					{sectionsTabDisplayRows.length === 0 && sectionsTabFilteredRows.length > 0 && (
						<div className={cn("flex flex-col items-center justify-center py-12", uiSurface.empty)}>
							<MagnifyingGlassIcon weight="duotone" className="mb-3 size-10 text-muted-foreground/50" />
							<p className="font-semibold text-foreground">{t`No sections match your search`}</p>
							<p className="mt-1 max-w-sm text-muted-foreground text-sm">
								{t`Try a different keyword or clear the search box.`}
							</p>
						</div>
					)}

					{sectionsTabFilteredRows.length === 0 && (dashboard?.sections ?? []).length > 0 && (
						<div className={cn("flex flex-col items-center justify-center py-12", uiSurface.empty)}>
							<WarningIcon weight="duotone" className="mb-3 size-10 text-amber-400" />
							<p className="font-semibold text-foreground">{t`No sections match the current filters`}</p>
							<p className="mt-1 max-w-sm text-muted-foreground text-sm">
								{t`Try clearing the package filter or pick a different unit type.`}
							</p>
						</div>
					)}
				</div>
			)}

			{/* ══════════════════ STUDENTS TAB ══════════════════ */}
			{activeTab === "students" && (
				<div className="space-y-5">
					{/* Filter */}
					{filterAllOrgUnits.length > 0 && (
						<div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
							<OrgUnitFilter
								allOrgUnits={filterAllOrgUnits}
								value={filter}
								onChange={(next) => {
									setFilter(next);
									navigate({ search: (prev: any) => ({ ...prev, ...next }) as any });
								}}
							/>
						</div>
					)}

					{!hasStudents ? (
						<div className={cn("flex flex-col items-center justify-center py-12", uiSurface.empty)}>
							<WarningIcon weight="duotone" className="mb-3 size-10 text-amber-400" />
							<p className="font-semibold text-foreground">No student data found</p>
						</div>
					) : (
						<StudentResumeTable
							students={filteredStudents}
							onReview={openReview}
							onStudentClick={(student) => setSelectedStudent(student)}
						/>
					)}
				</div>
			)}

			{/* ══════════════════ CHECKLISTS TAB ══════════════════ */}
			{activeTab === "checklists" && (
				<ChecklistsTab tenantId={tenantId} onCreateNew={() => setShowChecklistCreator(true)} />
			)}

			{selectedStudent && (
				<StudentDetailPanel
					student={{
						engLabsId: selectedStudent.engLabsId,
						name: selectedStudent.name,
						email: selectedStudent.email,
						rollNumber: selectedStudent.rollNumber,
						sectionName: selectedStudent.sectionName,
						resumeAppUserId: selectedStudent.resumeAppUserId,
						resumes: selectedStudent.resumes,
					}}
					tenantId={tenantId}
					open={!!selectedStudent}
					onOpenChange={(open) => !open && setSelectedStudent(null)}
				/>
			)}
			<ChecklistCreator tenantId={tenantId} open={showChecklistCreator} onOpenChange={setShowChecklistCreator} />

			{/* ══════════════════ PO SECTION REVIEW DIALOG ══════════════════ */}
			{poReviewDialog && (
				<POSectionReviewDialog
					open={!!poReviewDialog}
					onClose={() => setPoReviewDialog(null)}
					sectionId={poReviewDialog.sectionId}
					sectionName={poReviewDialog.sectionName}
					tenantId={tenantId}
					resumes={poReviewDialog.resumes}
					onSuccess={() => {
						queryClient.invalidateQueries({
							queryKey: orpc.resume.dashboard.sections.queryOptions({
								input: { sectionIds, tenantId, scope: scope as any },
							}).queryKey as any,
						});
					}}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// ATS Checks Card — queries ATS admin stats for the total checks count
// ---------------------------------------------------------------------------

function AtsChecksCard() {
	const { data: atsStats } = useQuery(orpc.ats.adminStats.queryOptions({ input: {} }));

	return (
		<Stat
			label={t`ATS checks`}
			value={atsStats?.totalChecks ?? 0}
			tooltip="Total number of ATS checks done by the students"
		/>
	);
}

// ---------------------------------------------------------------------------
// Section Students page — full-page drill-down for a single section
// ---------------------------------------------------------------------------

type SectionStudentsPageProps = {
	section?: {
		id: string;
		name: string;
		unitType: string;
		stats: {
			totalStudents: number;
			totalResumes: number;
			evaluatedResumes: number;
			averageScore: number | null;
		};
	};
	students: StudentWithResumes[];
	onBack: () => void;
	onReview: (resumeId: string, engLabsStudentId: string) => void;
	onStudentClick: (student: StudentWithResumes) => void;
};

function SectionStudentsPage({ section, students, onBack, onReview, onStudentClick }: SectionStudentsPageProps) {
	if (!section) {
		return (
			<div className="space-y-6">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-2 font-semibold text-muted-foreground text-sm transition-colors duration-200 hover:text-primary"
				>
					<ArrowLeftIcon weight="bold" className="size-4" />
					{t`Back to Sections`}
				</button>
				<div className={cn("flex flex-col items-center justify-center py-12", uiSurface.empty)}>
					<WarningIcon weight="duotone" className="mb-3 size-10 text-amber-400" />
					<p className="font-semibold text-foreground">{t`Section not found`}</p>
				</div>
			</div>
		);
	}

	const { stats } = section;
	const withResumes = students.filter((s) => s.resumes.length > 0).length;
	const noResumes = students.length - withResumes;
	const verifiedPct = stats.totalResumes > 0 ? (stats.evaluatedResumes / stats.totalResumes) * 100 : 0;

	return (
		<div className="space-y-6">
			{/* Breadcrumb / back */}
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-2 font-semibold text-muted-foreground text-sm transition-colors duration-200 hover:text-primary"
			>
				<ArrowLeftIcon weight="bold" className="size-4" />
				{t`Back to Sections`}
			</button>

			{/* Highlights */}
			<StatStrip>
				<Stat label={t`Total students`} value={stats.totalStudents} />
				<Stat
					label={t`With resumes`}
					value={withResumes}
					tooltip={t`Students who have created at least one resume`}
				/>
				<Stat label={t`No resume yet`} value={noResumes} />
				<Stat
					label={t`Average score`}
					value={
						stats.averageScore === null ? null : (
							<>
								{stats.averageScore.toFixed(1)}
								<span className="ml-0.5 font-medium text-base text-muted-foreground">/5</span>
							</>
						)
					}
					hint={stats.averageScore === null ? t`No evaluations yet` : undefined}
				/>
			</StatStrip>

			{/* Verified progress bar */}
			<div className={cn(uiSurface.card, "p-5")}>
				<div className="mb-3 flex items-end justify-between">
					<div>
						<p className="font-semibold text-foreground text-sm">{t`Verified progress`}</p>
						<p className="mt-0.5 text-muted-foreground text-xs">
							{stats.evaluatedResumes} / {stats.totalResumes} {t`resumes verified`}
						</p>
					</div>
					<span className="font-semibold text-2xl text-foreground tabular-nums">{verifiedPct.toFixed(0)}%</span>
				</div>
				<div className="h-1.5 overflow-hidden rounded-full bg-muted">
					<div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${verifiedPct}%` }} />
				</div>
			</div>

			{/* Students table */}
			{students.length === 0 ? (
				<div className={cn("flex flex-col items-center justify-center py-12", uiSurface.empty)}>
					<WarningIcon weight="duotone" className="mb-3 size-10 text-amber-400" />
					<p className="font-semibold text-foreground">{t`No students in this section`}</p>
				</div>
			) : (
				<StudentResumeTable students={students} onReview={onReview} onStudentClick={onStudentClick} />
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// ATS Improvements section — shown in the admin/PO overview tab
// ---------------------------------------------------------------------------

function AtsImprovementsSection() {
	return (
		<div className={cn(uiSurface.card, "space-y-4 p-6")}>
			<div>
				<h3 className="font-semibold text-foreground">{t`ATS score improvements`}</h3>
				<p className="text-muted-foreground text-xs">{t`How students' ATS scores change as they work through the suggestions.`}</p>
			</div>
			<AdminAtsStats />
		</div>
	);
}
