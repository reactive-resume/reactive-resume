import type { ApplicationSummary } from "@/features/applications/types";
import { t } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { HotkeysProvider, useHotkey } from "@tanstack/react-hotkeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useDeferredValue, useEffect, useId, useRef, useState } from "react";
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
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { Chip, FilterBar, FilterField } from "@/components/calm/filter-bar";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { takePostingCapture } from "@/features/applications/capture";
import { AddApplicationDialog } from "@/features/applications/components/add-application-dialog";
import { ApplicationBoard } from "@/features/applications/components/board";
import { ApplicationCalendar } from "@/features/applications/components/calendar-view";
import { ExportApplicationsSheet } from "@/features/applications/components/export-applications-sheet";
import { ImportApplicationsSheet } from "@/features/applications/components/import-applications-sheet";
import { ApplicationInsights, InsightsSkeleton } from "@/features/applications/components/insights-view";
import { ApplicationList } from "@/features/applications/components/list-view";
import { ManageLanesSheet } from "@/features/applications/components/manage-lanes-sheet";
import { getNextStep, needsFollowUp, needsYou as stepNeedsYou } from "@/features/applications/next-step";
import {
	applicationDetailQueryOptions,
	applicationsFullListQueryOptions,
	applicationsListQueryOptions,
	hydrateApplicationDetail,
	offerHintFor,
	useOfferHints,
} from "@/features/applications/queries";
import { applicationLanesQueryOptions, useApplicationLanes } from "@/features/applications/use-application-lanes";
import { useCareerTime, useNow } from "@/features/career/shared";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { toastError } from "@/libs/error-message";
import { getPageTitle } from "@/libs/seo";

const VIEWS = ["list", "board", "calendar", "insights"] as const;
type View = (typeof VIEWS)[number];

const searchSchema = z.object({
	q: z.string().default("").catch(""),
	view: z.enum(VIEWS).default("list").catch("list"),
	closed: z.boolean().default(false).catch(false),
	// Only applications that owe a follow-up (the banner's Show).
	followUp: z.boolean().default(false).catch(false),
	needsYou: z.boolean().default(false).catch(false),
	// Deep links: open Add, or one application (which now has its own page: see `beforeLoad`).
	create: z.boolean().default(false).catch(false),
	applicationId: z.string().optional().catch(undefined),
});
type Search = z.output<typeof searchSchema>;
const defaultSearch: Search = { q: "", view: "list", closed: false, followUp: false, needsYou: false, create: false };

// How long the page waits for the list and lanes before drawing anyway (a skeleton, or rows in the default order).
const LOADER_WAIT_MS = 1000;

export const Route = createFileRoute("/dashboard/applications/")({
	head: () => ({ meta: [{ title: getPageTitle(t`Applications`) }] }),
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
	// Today, notifications, emails and the phone apps link to one application as `?applicationId=`. An application is
	// a page now, so the old address goes there, with its stage and details open as the old sheet showed them.
	beforeLoad: ({ search }) => {
		if (!search.applicationId) return;
		throw redirect({
			to: "/dashboard/applications/$applicationId/{-$tab}",
			params: { applicationId: search.applicationId },
			search: { details: true },
			replace: true,
		});
	},
	// Arrive with the list, as Documents does: a new account sees "Follow each job from saved to offer" at once, not a toolbar and a
	// skeleton that then vanish. The lanes come with it when they're quick, so rows first draw in the owner's lane order;
	// slow or failing requests never hold the page (it shows the defaults and the lanes' own error). A failed list still
	// renders the page, which shows its error and retry.
	// The two requests can share one batch, so one bound covers both.
	loader: async ({ context }) => {
		await Promise.race([
			Promise.allSettled([
				context.queryClient.ensureQueryData(applicationsListQueryOptions()),
				context.queryClient.ensureQueryData(applicationLanesQueryOptions()),
			]),
			new Promise((resolve) => setTimeout(resolve, LOADER_WAIT_MS)),
		]);
	},
});

// Each view's name at its own width, as drawn; on a phone the four share the row.
const segment = "sm:flex-none";

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
	const { t } = useLingui();
	const { q, view, closed, followUp, needsYou, create } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const phone = useBreakpoint() === "mobile";
	// Typing filters at once; the URL only seeds the search.
	const [query, setQuery] = useState(q);
	const overlayScope = `applications-overlay-${useId()}`;
	const pageRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const [capture, setCapture] = useState(takePostingCapture);
	const [adding, setAdding] = useState(!!capture);
	const [importing, setImporting] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [exportLoading, setExportLoading] = useState(false);
	const [managingLanes, setManagingLanes] = useState(false);
	const lanes = useApplicationLanes();
	// Views animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);

	const { data: applications, isPending, isError, isFetching, refetch } = useQuery(applicationsListQueryOptions());
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey(
		"/",
		(event) => {
			if (event.keyCode === 229) return;
			searchRef.current?.focus();
		},
		{
			enabled: characterShortcuts && Boolean(applications?.length),
			target: pageRef,
			meta: { name: t`Filter applications` },
		},
	);
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

	// The application's page opens on what the list already has, then refreshes.
	useEffect(() => {
		if (!applications) return;
		for (const application of applications) hydrateApplicationDetail(queryClient, application);
	}, [applications, queryClient]);

	// Pointing at or focusing a row's, card's or calendar entry's link fetches the application before the click.
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
	const filterByTag = useCallback((tag: string) => setQuery(tag), []);
	const clearFilters = () => {
		setQuery("");
		setSearch({ q: "", needsYou: false, followUp: false, closed: false });
	};

	useEffect(() => {
		if (!create) return;
		// oxlint-disable-next-line react/set-state-in-effect -- takes the one-shot ?create flag from the address, then clears it
		setAdding(true);
		void navigate({ replace: true, resetScroll: false, search: (prev: Search) => ({ ...prev, create: false }) });
	}, [create, navigate]);

	// The input updates at once; the list filters in a deferred render that typing can interrupt.
	const text = useDeferredValue(query).trim().toLowerCase();
	const now = useNow();
	const { timeZone } = useCareerTime();
	const offers = useOfferHints();
	const owed = (application: ApplicationSummary) =>
		(offers === undefined && application.status === "offer") ||
		stepNeedsYou(getNextStep(application, now, timeZone, offerHintFor(offers, application.id)), now);
	const matching = (applications ?? []).filter(
		(application) =>
			matches(application, text) && (!followUp || needsFollowUp(getNextStep(application, now, timeZone), now)),
	);
	const owedCount = matching.filter(owed).length;
	const filtered = needsYou ? matching.filter(owed) : matching;
	const closedCount = filtered.filter((application) => application.status === "closed").length;
	// Columns wrap at narrow widths, so every view stays available on phones.
	const shown: View = view;
	const empty = !!applications && applications.length === 0;
	const noMatches = !!applications && !empty && text && filtered.length === 0;
	const noAttentionMatches = !!applications && !empty && needsYou && filtered.length === 0;
	// Every application is closed and closed ones are hidden: say so, as the phone app does, instead of a bare header.
	const allClosed =
		!!applications && !empty && !closed && !text && filtered.length > 0 && closedCount === filtered.length;
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

	// The one line under the list and the board: closed applications stay out of the way until asked for.
	const closedLine = closedCount > 0 && (
		<p className="flex items-center gap-2.5 pt-4 text-[13px]/[18px] text-ink-3">
			{closed ? (
				<Plural value={closedCount} one="Showing # closed application" other="Showing # closed applications" />
			) : (
				<Plural value={closedCount} one="# closed application" other="# closed applications" />
			)}
			<button
				type="button"
				onClick={() => setSearch({ closed: !closed })}
				className="touch-target relative rounded-xs text-[13px]/5 font-medium text-accent-text"
			>
				{closed ? <Trans>Hide</Trans> : <Trans>Show</Trans>}
			</button>
		</p>
	);

	return (
		<Page ref={pageRef} tabIndex={-1} className="pb-24 outline-none">
			<PageBody className="pb-0">
				<RootHeader
					title={<Trans>Applications</Trans>}
					actions={
						<>
							{/* One More menu beside the one accent action: icon-only buttons are for back, close and more. */}
							<DropdownMenu>
								<DropdownMenuTrigger render={<Button size="icon" variant="secondary" aria-label={t`More`} />}>
									<Icon name="dots-three" size={20} />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<HotkeysProvider scope={`${overlayScope}-more`} exclusive>
										<DropdownMenuItem onClick={() => setImporting(true)}>
											<Trans>Import CSV…</Trans>
										</DropdownMenuItem>
										<DropdownMenuItem
											disabled={empty || !applications || exportLoading}
											onClick={() => void openExport()}
										>
											<Trans>Export CSV…</Trans>
										</DropdownMenuItem>
										{!lanes.unsupported && (
											<DropdownMenuItem onClick={() => setManagingLanes(true)}>
												<Trans>Manage stages…</Trans>
											</DropdownMenuItem>
										)}
									</HotkeysProvider>
								</DropdownMenuContent>
							</DropdownMenu>
							{/* The empty state has its own Save a job: one accent action, not two. */}
							{!empty && (
								<Button
									variant="primary"
									onClick={() => setAdding(true)}
									aria-label={t`Save a job`}
									className="max-sm:size-11 max-sm:p-0"
								>
									<Icon name="plus" />
									<span className="max-sm:hidden">
										<Trans>Save a job</Trans>
									</span>
								</Button>
							)}
							<PhoneHeaderActions />
						</>
					}
				/>

				{applications !== undefined && !empty && (
					<FilterBar className="pt-5">
						<SegmentedControl
							aria-label={t`View`}
							value={shown}
							onValueChange={(value) => {
								setViewSwitched(true);
								setSearch({ view: value as View });
							}}
							className="max-sm:w-full"
						>
							<SegmentedControlItem value="list" className={segment}>
								<Icon name="list" />
								<Trans>List</Trans>
							</SegmentedControlItem>
							<SegmentedControlItem value="board" className={segment}>
								<Icon name="kanban" />
								<Trans>Board</Trans>
							</SegmentedControlItem>
							<SegmentedControlItem value="calendar" className={segment}>
								<Icon name="calendar-blank" />
								<Trans>Calendar</Trans>
							</SegmentedControlItem>
							<SegmentedControlItem value="insights" className={segment}>
								<Icon name="chart-line-up" />
								<Trans>Insights</Trans>
							</SegmentedControlItem>
						</SegmentedControl>

						{/* Nothing on Insights is a list, and its charts always count every application. */}
						{shown !== "insights" && (
							<>
								<span className="flex-1 max-sm:hidden" />
								<FilterField
									ref={searchRef}
									label={t`Filter applications`}
									{...(characterShortcuts ? { shortcut: "/" } : {})}
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									className="max-sm:w-auto max-sm:flex-1"
								/>
								<Chip pressed={needsYou} onClick={() => setSearch({ needsYou: !needsYou })}>
									<Trans>Needs you</Trans>
									<span className="font-mono text-xs font-medium text-ink-3">{owedCount}</span>
								</Chip>
							</>
						)}
					</FilterBar>
				)}

				{applications && followUp && (
					<p role="status" className="flex flex-wrap items-center gap-2.5 pt-3 text-[13px]/[18px] text-ink-3">
						<Plural
							value={filtered.length}
							one="Showing # application that needs a follow-up."
							other="Showing # applications that need a follow-up."
						/>
						<button
							type="button"
							onClick={() => setSearch({ followUp: false })}
							className="touch-target relative rounded-xs text-[13px]/5 font-medium text-accent-text"
						>
							<Trans>Show all</Trans>
						</button>
					</p>
				)}

				{isError && (
					<div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
						<p className="text-sm text-danger-text">
							<Trans>Couldn't load applications. Your saved data hasn't changed.</Trans>
						</p>
						<Button variant="secondary" size="sm" loading={isFetching} onClick={() => void refetch()}>
							{isFetching ? <Trans>Retrying…</Trans> : <Trans>Retry</Trans>}
						</Button>
					</div>
				)}

				{lanes.error && (
					<div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3">
						<p className="text-sm text-danger-text">
							<Trans>Couldn't load your stages, so the standard ones are shown. Try again.</Trans>
						</p>
						<Button variant="secondary" size="sm" onClick={() => void lanes.refetch()}>
							<Trans>Retry</Trans>
						</Button>
					</div>
				)}

				{isError && !applications ? null : empty ? (
					<EmptyState
						title={<Trans>Follow each job from saved to offer</Trans>}
						description={
							<Trans>Paste a job link. The posting is kept, so Check, the assistant and your letter can use it.</Trans>
						}
						action={
							<Button onClick={() => setAdding(true)}>
								<Icon name="plus" />
								<Trans>Save a job</Trans>
							</Button>
						}
						secondary={
							<Button variant="secondary" onClick={() => setImporting(true)}>
								<Trans>Import from CSV</Trans>
							</Button>
						}
						className="mt-6 transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0"
					/>
				) : isPending ? (
					<ViewSkeleton view={shown} />
				) : allClosed && (shown === "list" || shown === "board") ? (
					<EmptyState
						title={<Trans>All your applications are closed</Trans>}
						description={<Trans>Show closed applications to see your past job searches.</Trans>}
						action={
							<Button variant="secondary" onClick={() => setSearch({ closed: true })}>
								<Trans>Show closed applications</Trans>
							</Button>
						}
						className="mt-6"
					/>
				) : noAttentionMatches || noMatches ? (
					<EmptyState
						title={
							noAttentionMatches ? (
								<Trans>No matching applications</Trans>
							) : (
								<Trans>No applications match “{query.trim()}”.</Trans>
							)
						}
						description={<Trans>Try different words or clear your filters.</Trans>}
						action={
							<Button variant="secondary" onClick={clearFilters}>
								<Trans>Clear filters</Trans>
							</Button>
						}
						className="mt-6"
					/>
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
								onTagSelect={filterByTag}
								footer={closedLine}
							/>
						)}
						{shown === "board" && (
							<>
								<ApplicationBoard applications={filtered} showClosed={closed} onSaveJob={() => setAdding(true)} />
								{closedLine}
							</>
						)}
						{shown === "calendar" && (
							<ApplicationCalendar
								compact={phone}
								applications={filtered.filter((application) => closed || application.status !== "closed")}
								allApplications={applications ?? []}
								onClearFilters={text || needsYou || followUp ? clearFilters : undefined}
							/>
						)}
						{shown === "insights" && <ApplicationInsights applications={applications ?? []} />}
					</div>
				)}
			</PageBody>

			<HotkeysProvider scope={overlayScope} exclusive enabled={adding || importing || exporting || managingLanes}>
				<AddApplicationDialog
					open={adding}
					initialCapture={capture}
					onOpenChange={(open) => {
						setAdding(open);
						if (!open) setCapture(null);
					}}
					onAdded={(id) =>
						void navigate({ to: "/dashboard/applications/$applicationId/{-$tab}", params: { applicationId: id } })
					}
				/>
				<ImportApplicationsSheet open={importing} onOpenChange={setImporting} />
				<ManageLanesSheet open={managingLanes} onOpenChange={setManagingLanes} />
				<ExportApplicationsSheet
					open={exporting}
					onOpenChange={setExporting}
					applications={fullApplications ?? []}
					filtered={filteredFullApplications.filter((application) => closed || application.status !== "closed")}
				/>
			</HotkeysProvider>
		</Page>
	);
}

/** Each view's shape while applications load, so the first rows land where the placeholders were. */
function ViewSkeleton({ view }: { view: View }) {
	if (view === "insights") return <InsightsSkeleton />;
	if (view === "list")
		return (
			<div className="mt-3 grid gap-px pt-8">
				{Array.from({ length: 5 }, (_, index) => (
					<Skeleton key={index} className="h-14" />
				))}
			</div>
		);
	return <Skeleton className="mt-3 h-96 rounded-lg" />;
}
