import type { Application, ApplicationSummary } from "@/features/applications/types";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { PageHeader } from "@/components/layout/page-header";
import { takePostingCapture } from "@/features/applications/capture";
import { AddApplicationDialog } from "@/features/applications/components/add-application-dialog";
import { ApplicationDetailSheet } from "@/features/applications/components/application-detail-sheet";
import { ApplicationFormSheet } from "@/features/applications/components/application-form-sheet";
import { ApplicationBoard } from "@/features/applications/components/board";
import { ApplicationCalendar } from "@/features/applications/components/calendar-view";
import { ExportApplicationsSheet } from "@/features/applications/components/export-applications-sheet";
import { ImportApplicationsSheet } from "@/features/applications/components/import-applications-sheet";
import { ApplicationInsights, InsightsSkeleton } from "@/features/applications/components/insights-view";
import { ApplicationList } from "@/features/applications/components/list-view";
import { ManageLanesSheet } from "@/features/applications/components/manage-lanes-sheet";
import { getNextStep, needsFollowUp } from "@/features/applications/next-step";
import {
	applicationDetailQueryOptions,
	applicationsFullListQueryOptions,
	applicationsListQueryOptions,
	hydrateApplicationDetail,
} from "@/features/applications/queries";
import { useApplicationLanes } from "@/features/applications/use-application-lanes";
import { useCareerTime, useNow } from "@/features/career/shared";
import { toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { getPageTitle } from "@/libs/seo";

const VIEWS = ["list", "board", "insights", "calendar"] as const;
type View = (typeof VIEWS)[number];

const searchSchema = z.object({
	q: z.string().default("").catch(""),
	view: z.enum(VIEWS).default("list").catch("list"),
	closed: z.boolean().default(false).catch(false),
	// Only applications that owe a follow-up (the banner's Show).
	followUp: z.boolean().default(false).catch(false),
	// Deep links: open Add, or one application.
	create: z.boolean().default(false).catch(false),
	applicationId: z.string().optional().catch(undefined),
});
type Search = z.output<typeof searchSchema>;
const defaultSearch: Search = { q: "", view: "list", closed: false, followUp: false, create: false };

export const Route = createFileRoute("/dashboard/applications/")({
	head: () => ({ meta: [{ title: getPageTitle(t`Applications`) }] }),
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
	// Arrive with the list, as Documents does: a new account sees "Track your first job" at once, not a toolbar and a
	// skeleton that then vanish. A failed load still renders the page, which shows its error and retry.
	loader: ({ context }) => context.queryClient.ensureQueryData(applicationsListQueryOptions()).catch(() => undefined),
});

/** Search reads role, company, location, contacts and tags. */
function matches(application: ApplicationSummary, query: string) {
	if (!query) return true;
	const haystack = [
		application.role,
		application.company,
		application.location ?? "",
		...application.contacts.map((contact) => contact.name),
		...application.tags,
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(query);
}

function RouteComponent() {
	const { q, view, closed, followUp, create, applicationId } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const phone = useBreakpoint() === "mobile";
	// Typing filters at once; the URL only seeds the search.
	const [query, setQuery] = useState(q);
	const [capture, setCapture] = useState(takePostingCapture);
	const [adding, setAdding] = useState(!!capture);
	const [importing, setImporting] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportLoading, setExportLoading] = useState(false);
	const [managingLanes, setManagingLanes] = useState(false);
	const lanes = useApplicationLanes();
	const [editing, setEditing] = useState<Application | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Views animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);

	const { data: applications, isPending, isError, isFetching, refetch } = useQuery(applicationsListQueryOptions());
	const queryClient = useQueryClient();
	const { data: fullApplications } = useQuery({ ...applicationsFullListQueryOptions(), enabled: exporting });

	const PREFETCH_LIMIT = 12;
	const prefetchInFlight = useRef(new Set<string>());
	const prefetch = useCallback(
		(id: string) => {
			const options = applicationDetailQueryOptions(id);
			if (
				prefetchInFlight.current.has(id) ||
				prefetchInFlight.current.size >= PREFETCH_LIMIT ||
				queryClient.getQueryData(options.queryKey) ||
				queryClient.getQueryState(options.queryKey)?.fetchStatus === "fetching"
			)
				return;
			prefetchInFlight.current.add(id);
			void queryClient
				.fetchQuery(options)
				.catch(() => {})
				.finally(() => prefetchInFlight.current.delete(id));
		},
		[queryClient],
	);

	useEffect(() => {
		if (!applications) return;
		for (const application of applications) hydrateApplicationDetail(queryClient, application);
	}, [applications, queryClient]);

	useEffect(() => {
		let timer: number | undefined;
		const openControl = (target: EventTarget | null) =>
			target instanceof Element ? target.closest<HTMLElement>("[data-application-open]") : null;
		const onPointerOver = (event: PointerEvent) => {
			const open = openControl(event.target);
			if (!open || open.contains(event.relatedTarget as Node | null)) return;
			const id = open.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId;
			if (!id) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => prefetch(id), 120);
		};
		const onPointerOut = (event: PointerEvent) => {
			const open = openControl(event.target);
			if (open && !open.contains(event.relatedTarget as Node | null)) window.clearTimeout(timer);
		};
		const onFocusIn = (event: FocusEvent) => {
			const id = openControl(event.target)?.closest<HTMLElement>("[data-application-id]")?.dataset.applicationId;
			if (id) {
				window.clearTimeout(timer);
				prefetch(id);
			}
		};
		document.addEventListener("pointerover", onPointerOver);
		document.addEventListener("pointerout", onPointerOut);
		document.addEventListener("focusin", onFocusIn);
		return () => {
			document.removeEventListener("pointerover", onPointerOver);
			document.removeEventListener("pointerout", onPointerOut);
			document.removeEventListener("focusin", onFocusIn);
			window.clearTimeout(timer);
		};
	}, [prefetch]);
	const setSearch = (patch: Partial<Search>) =>
		void navigate({ resetScroll: false, search: (prev: Search) => ({ ...prev, ...patch }) });

	useEffect(() => {
		if (!create) return;
		// oxlint-disable-next-line react/set-state-in-effect -- takes the one-shot ?create flag from the address, then clears it
		setAdding(true);
		void navigate({ replace: true, resetScroll: false, search: (prev: Search) => ({ ...prev, create: false }) });
	}, [create, navigate]);

	useEffect(() => {
		if (!applicationId || !applications) return;
		// oxlint-disable-next-line react/set-state-in-effect -- takes the one-shot ?applicationId from the address, then clears it
		setSelectedId(applicationId);
		void navigate({
			replace: true,
			resetScroll: false,
			search: (prev: Search) => ({ ...prev, applicationId: undefined }),
		});
	}, [applicationId, applications, navigate]);

	// The input updates at once; the list filters in a deferred render that typing can interrupt.
	const text = useDeferredValue(query).trim().toLowerCase();
	const now = useNow();
	const { timeZone } = useCareerTime();
	const filtered = (applications ?? []).filter(
		(application) =>
			matches(application, text) && (!followUp || needsFollowUp(getNextStep(application, now, timeZone), now)),
	);
	const selected = applications?.find((application) => application.id === selectedId) ?? null;
	// The board needs room to drag: phones get the list instead.
	const shown: View = phone && view === "board" ? "list" : view;
	const empty = !!applications && applications.length === 0;
	// Hoisted so the compiler keeps one function; inline, it changes with every keystroke and re-renders each row.
	const openApplication = (application: ApplicationSummary) => {
		hydrateApplicationDetail(queryClient, application);
		setSelectedId(application.id);
	};
	const noMatches = !!applications && !empty && text && filtered.length === 0;
	const filteredIds = new Set(filtered.map((application) => application.id));
	const filteredFullApplications = fullApplications?.filter((application) => filteredIds.has(application.id)) ?? [];
	const openExport = async () => {
		if (exportLoading) return;
		setExportLoading(true);
		try {
			await queryClient.fetchQuery({ ...applicationsFullListQueryOptions(), staleTime: 0 });
			setExporting(true);
		} catch (error) {
			toastError(error, t`Couldn't load this. Your saved data hasn't changed.`);
		} finally {
			setExportLoading(false);
		}
	};

	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<PageHeader
				title={<Trans>Applications</Trans>}
				actions={
					<>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button size="icon" variant="secondary" aria-label={t`Import or export CSV`} />}
							>
								<Icon name="arrows-down-up" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => setImporting(true)}>
									<Trans>Import from CSV…</Trans>
								</DropdownMenuItem>
								<DropdownMenuItem disabled={empty || !applications || exportLoading} onClick={() => void openExport()}>
									<Trans>Export to CSV…</Trans>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						{!lanes.unsupported && (
							<Button
								size="icon"
								variant="secondary"
								aria-label={t`Manage stages`}
								title={t`Manage stages`}
								onClick={() => setManagingLanes(true)}
							>
								<Icon name="sliders-horizontal" />
							</Button>
						)}
						<Button onClick={() => setAdding(true)}>
							<Icon name="plus" />
							<Trans>Save job</Trans>
						</Button>
					</>
				}
			>
				{applications !== undefined && !empty && (
					<>
						<Tabs
							value={shown}
							onValueChange={(value) => {
								setViewSwitched(true);
								setSearch({ view: value as View });
							}}
						>
							<TabsList aria-label={t`View`}>
								<TabsTrigger value="list">
									<Icon name="rows" size={18} />
									<Trans>List</Trans>
								</TabsTrigger>
								{!phone && (
									<TabsTrigger value="board">
										<Icon name="kanban" size={18} />
										<Trans>Board</Trans>
									</TabsTrigger>
								)}
								<TabsTrigger value="insights">
									<Icon name="chart-line-up" size={18} />
									<Trans>Insights</Trans>
								</TabsTrigger>
								<TabsTrigger value="calendar">
									<Icon name="calendar-dots" size={18} />
									<Trans>Calendar</Trans>
								</TabsTrigger>
							</TabsList>
						</Tabs>

						<div className="relative max-w-72 min-w-40 flex-1">
							<Icon
								name="magnifying-glass"
								size={18}
								className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
							/>
							<Input
								type="search"
								aria-label={t`Search applications`}
								placeholder={t`Search role, company or contact`}
								value={query}
								className="ps-8"
								onChange={(event) => setQuery(event.target.value)}
							/>
						</div>

						{shown !== "insights" && (
							<Button
								variant="secondary"
								aria-pressed={closed}
								onClick={() => setSearch({ closed: !closed })}
								className={cn(closed && "bg-sunken")}
							>
								<Icon name={closed ? "check-square" : "square"} size={18} />
								<Trans>Show closed applications</Trans>
							</Button>
						)}
					</>
				)}
			</PageHeader>

			{applications &&
				(followUp ? (
					<div role="status" className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
						<Icon name="clock" size={18} className="text-warn-text" />
						<span>
							<Plural
								value={filtered.length}
								one="Showing # application that needs a follow-up."
								other="Showing # applications that need a follow-up."
							/>
						</span>
						<Button size="sm" variant="secondary" onClick={() => setSearch({ followUp: false })}>
							<Trans>Show all</Trans>
						</Button>
					</div>
				) : (
					<FollowUpNudge
						applications={applications}
						onOpen={setSelectedId}
						onShowAll={() => setSearch({ followUp: true, closed: false })}
					/>
				))}

			{isError && (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
				>
					<p className="text-sm text-danger-text">
						<Trans>Couldn't load applications. Try again.</Trans>
					</p>
					<Button variant="secondary" disabled={isFetching} onClick={() => void refetch()}>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}

			{lanes.error && (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
				>
					<p className="text-sm text-danger-text">
						<Trans>Couldn't load your stages, so the standard ones are shown. Try again.</Trans>
					</p>
					<Button variant="secondary" onClick={() => void lanes.refetch()}>
						<Trans>Retry</Trans>
					</Button>
				</div>
			)}

			{isError && !applications ? null : empty ? (
				<EmptyState
					title={<Trans>Track your first job</Trans>}
					description={
						<Trans>Paste a job link. We'll save the posting so Check, the assistant and your letter can use it.</Trans>
					}
					action={
						<Button onClick={() => setAdding(true)}>
							<Icon name="plus" />
							<Trans>Save job</Trans>
						</Button>
					}
					secondary={
						<Button variant="secondary" onClick={() => setImporting(true)}>
							<Trans>Import from CSV</Trans>
						</Button>
					}
					className="transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0"
				/>
			) : (
				<>
					{isPending ? (
						<ViewSkeleton view={shown} />
					) : noMatches ? (
						<div className="grid justify-items-center gap-2 py-16 text-center">
							<p className="text-sm font-medium">
								<Trans>No applications match “{query.trim()}”.</Trans>
							</p>
							<Button size="sm" variant="secondary" onClick={() => setQuery("")}>
								<Trans>Clear search</Trans>
							</Button>
						</div>
					) : (
						<div
							key={shown}
							className={cn(
								viewSwitched
									? "transition-[opacity,translate] duration-standard ease-enter starting:translate-y-1 starting:opacity-0"
									: // The list fades in on its first appearance, after its skeleton.
										shown === "list" && "transition-opacity duration-standard ease-enter starting:opacity-0",
							)}
						>
							{shown === "list" && (
								<ApplicationList
									applications={filtered}
									showClosed={closed}
									selectedId={selectedId}
									onOpen={openApplication}
								/>
							)}
							{shown === "board" && (
								<div className="h-[calc(100svh-230px)] min-h-96">
									<ApplicationBoard applications={filtered} showClosed={closed} onOpen={openApplication} />
								</div>
							)}
							{shown === "insights" && (
								<ApplicationInsights applications={applications ?? []} onSaveJob={() => setAdding(true)} />
							)}
							{shown === "calendar" && (
								<ApplicationCalendar
									compact={phone}
									applications={filtered.filter((application) => closed || application.status !== "closed")}
									allApplications={applications ?? []}
									onOpen={openApplication}
								/>
							)}
						</div>
					)}
				</>
			)}

			<AddApplicationDialog
				open={adding}
				initialCapture={capture}
				onOpenChange={(open) => {
					setAdding(open);
					if (!open) setCapture(null);
				}}
				onAdded={setSelectedId}
			/>
			<ApplicationFormSheet
				open={Boolean(editing)}
				application={editing}
				onOpenChange={(open) => !open && setEditing(null)}
			/>
			<ImportApplicationsSheet open={importing} onOpenChange={setImporting} />
			<ManageLanesSheet open={managingLanes} onOpenChange={setManagingLanes} />
			<ExportApplicationsSheet
				open={exporting}
				onOpenChange={setExporting}
				applications={fullApplications ?? []}
				filtered={filteredFullApplications.filter((application) => closed || application.status !== "closed")}
			/>
			<ApplicationDetailSheet
				application={selected}
				onOpenChange={(open) => !open && setSelectedId(null)}
				onEditDetails={(application) => {
					setSelectedId(null);
					setEditing(application);
				}}
			/>
		</div>
	);
}

const NUDGE_STORAGE_KEY = "applications-follow-up-dismissed";

function readDismissed(): string[] {
	try {
		return JSON.parse(window.localStorage.getItem(NUDGE_STORAGE_KEY) ?? "[]") as string[];
	} catch {
		return [];
	}
}

type FollowUpNudgeProps = {
	applications: ApplicationSummary[];
	onOpen: (id: string) => void;
	onShowAll: () => void;
};

/**
 * The follow-up nudge: applications that owe a follow-up (a due follow-up date, or 10+ days without a reply), from the
 * same next-step rules Career → Today reads. One is named; several are counted with Show to filter the list.
 * Dismissing is remembered on this device; dismissed applications don't come back here.
 */
function FollowUpNudge({ applications, onOpen, onShowAll }: FollowUpNudgeProps) {
	const { timeZone } = useCareerTime();
	const now = useNow();
	const [dismissed, setDismissed] = useState(readDismissed);

	const dismissedIds = new Set(dismissed);
	const owed = applications
		.filter((application) => !dismissedIds.has(application.id))
		.flatMap((application) => {
			const step = getNextStep(application, now, timeZone);
			return needsFollowUp(step, now) ? [{ application, step }] : [];
		})
		// The longest silence first; dated follow-ups after it.
		.sort((a, b) => (b.step.kind === "no-reply" ? b.step.days : -1) - (a.step.kind === "no-reply" ? a.step.days : -1));
	const first = owed[0];
	if (!first) return null;

	const dismiss = () => {
		const next = [...dismissed, ...owed.map(({ application }) => application.id)].slice(-1000);
		setDismissed(next);
		try {
			window.localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Without storage the nudge is dismissed for this visit only.
		}
	};

	const { company } = first.application;
	const count = owed.length;
	const days = first.step.kind === "no-reply" ? first.step.days : 0;

	return (
		<div
			key={owed.length === 1 ? first.application.id : "several"}
			data-application-id={owed.length === 1 ? first.application.id : undefined}
			role="status"
			className={cn(
				ENTER_CLASS,
				"flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-text",
			)}
		>
			<Icon name="clock" size={20} />
			<span className="min-w-0 flex-1">
				{owed.length > 1 ? (
					<Plural value={count} one="# application needs a follow-up." other="# applications need a follow-up." />
				) : first.step.kind === "no-reply" ? (
					<Plural
						value={days}
						one={`${company}: no reply for # day. A short follow-up is usually fine now.`}
						other={`${company}: no reply for # days. A short follow-up is usually fine now.`}
					/>
				) : (
					<Trans>{company}: a follow-up is due.</Trans>
				)}
			</span>
			{owed.length > 1 ? (
				<Button size="sm" variant="secondary" onClick={onShowAll}>
					<Trans>Show</Trans>
				</Button>
			) : (
				<Button size="sm" variant="secondary" data-application-open onClick={() => onOpen(first.application.id)}>
					<Trans>Open</Trans>
				</Button>
			)}
			<Button size="icon-sm" variant="ghost" aria-label={t`Dismiss`} onClick={dismiss} className="text-warn-text">
				<Icon name="x" size={18} />
			</Button>
		</div>
	);
}

/** Each view's shape while applications load, so the first rows land where the placeholders were. */
function ViewSkeleton({ view }: { view: View }) {
	if (view === "insights") return <InsightsSkeleton />;
	if (view === "list")
		return (
			<div className="grid gap-2 pt-10">
				{Array.from({ length: 6 }, (_, index) => (
					<Skeleton key={index} className="h-[52px]" />
				))}
			</div>
		);
	return <Skeleton className="h-[calc(100svh-230px)] min-h-96 rounded-xl" />;
}
