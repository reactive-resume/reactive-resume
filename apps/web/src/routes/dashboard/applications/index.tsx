import type { Application } from "@/features/applications/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { AddApplicationDialog } from "@/features/applications/components/add-application-dialog";
import { ApplicationDetailSheet } from "@/features/applications/components/application-detail-sheet";
import { ApplicationFormSheet } from "@/features/applications/components/application-form-sheet";
import { ApplicationBoard } from "@/features/applications/components/board";
import { ApplicationCalendar } from "@/features/applications/components/calendar-view";
import { ExportApplicationsSheet } from "@/features/applications/components/export-applications-sheet";
import { ImportApplicationsSheet } from "@/features/applications/components/import-applications-sheet";
import { ApplicationInsights, InsightsSkeleton } from "@/features/applications/components/insights-view";
import { ApplicationList } from "@/features/applications/components/list-view";
import { getNextStep } from "@/features/applications/next-step";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { ENTER_CLASS } from "@/libs/motion";

const VIEWS = ["list", "board", "insights", "calendar"] as const;
type View = (typeof VIEWS)[number];

const searchSchema = z.object({
	q: z.string().default("").catch(""),
	view: z.enum(VIEWS).default("list").catch("list"),
	closed: z.boolean().default(false).catch(false),
	// Deep links: open Add, or one application.
	create: z.boolean().default(false).catch(false),
	applicationId: z.string().optional().catch(undefined),
});
type Search = z.output<typeof searchSchema>;
const defaultSearch: Search = { q: "", view: "list", closed: false, create: false };

export const Route = createFileRoute("/dashboard/applications/")({
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
});

/** Search reads role, company, location, contacts and tags. */
function matches(application: Application, query: string) {
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
	const { q, view, closed, create, applicationId } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const phone = useBreakpoint() === "mobile";
	// Typing filters at once; the URL only seeds the search.
	const [query, setQuery] = useState(q);
	const [adding, setAdding] = useState(false);
	const [importing, setImporting] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [editing, setEditing] = useState<Application | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Views animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);

	const { data: applications, isPending } = useQuery(applicationsListQueryOptions());
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

	const text = query.trim().toLowerCase();
	const filtered = (applications ?? []).filter((application) => matches(application, text));
	const selected = applications?.find((application) => application.id === selectedId) ?? null;
	// The board needs room to drag: phones get the list instead.
	const shown: View = phone && (view === "board" || view === "calendar") ? "list" : view;
	const empty = !isPending && (applications?.length ?? 0) === 0;
	const noMatches = !empty && text && filtered.length === 0;

	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="font-display text-[30px] leading-9 font-medium">
					<Trans>Applications</Trans>
				</h1>
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger
							render={<Button size="icon" variant="secondary" aria-label={t`Import or export CSV`} />}
						>
							<Icon name="import_export" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => setImporting(true)}>
								<Trans>Import from CSV…</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem disabled={empty} onClick={() => setExporting(true)}>
								<Trans>Export to CSV…</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button onClick={() => setAdding(true)}>
						<Icon name="add" />
						<Trans>Save job</Trans>
					</Button>
				</div>
			</header>

			{applications && <FollowUpNudge applications={applications} onOpen={setSelectedId} />}

			{empty ? (
				<EmptyState onAdd={() => setAdding(true)} onImport={() => setImporting(true)} />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<Tabs
							value={shown}
							onValueChange={(value) => {
								setViewSwitched(true);
								setSearch({ view: value as View });
							}}
						>
							<TabsList aria-label={t`View`}>
								<TabsTrigger value="list">
									<Icon name="view_agenda" size={18} />
									<Trans>List</Trans>
								</TabsTrigger>
								{!phone && (
									<TabsTrigger value="board">
										<Icon name="view_kanban" size={18} />
										<Trans>Board</Trans>
									</TabsTrigger>
								)}
								<TabsTrigger value="insights">
									<Icon name="insights" size={18} />
									<Trans>Insights</Trans>
								</TabsTrigger>
								{!phone && (
									<TabsTrigger value="calendar">
										<Icon name="calendar_month" size={18} />
										<Trans>Calendar</Trans>
									</TabsTrigger>
								)}
							</TabsList>
						</Tabs>

						<div className="relative max-w-72 min-w-40 flex-1">
							<Icon
								name="search"
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
								<Icon name={closed ? "check_box" : "check_box_outline_blank"} size={18} />
								<Trans>Show closed</Trans>
							</Button>
						)}
					</div>

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
									onOpen={(application) => setSelectedId(application.id)}
								/>
							)}
							{shown === "board" && (
								<div className="h-[calc(100svh-230px)] min-h-96">
									<ApplicationBoard
										applications={filtered}
										showClosed={closed}
										onOpen={(application) => setSelectedId(application.id)}
									/>
								</div>
							)}
							{shown === "insights" && <ApplicationInsights applications={applications ?? []} />}
							{shown === "calendar" && (
								<ApplicationCalendar
									applications={filtered.filter((application) => closed || application.status !== "closed")}
									allApplications={applications ?? []}
									onOpen={(application) => setSelectedId(application.id)}
								/>
							)}
						</div>
					)}
				</>
			)}

			<AddApplicationDialog open={adding} onOpenChange={setAdding} onAdded={setSelectedId} />
			<ApplicationFormSheet
				open={Boolean(editing)}
				application={editing}
				onOpenChange={(open) => !open && setEditing(null)}
			/>
			<ImportApplicationsSheet open={importing} onOpenChange={setImporting} />
			<ExportApplicationsSheet
				open={exporting}
				onOpenChange={setExporting}
				applications={applications ?? []}
				filtered={filtered.filter((application) => closed || application.status !== "closed")}
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

/**
 * The follow-up nudge: the application waiting longest without a reply (10+ days since applying). Dismissing it is
 * remembered on this device; it doesn't come back for that application.
 */
function FollowUpNudge({ applications, onOpen }: { applications: Application[]; onOpen: (id: string) => void }) {
	const [dismissed, setDismissed] = useState(readDismissed);

	const dismissedIds = new Set(dismissed);
	const waiting = applications
		.filter((application) => !dismissedIds.has(application.id))
		.flatMap((application) => {
			const step = getNextStep(application);
			return step.kind === "no-reply" ? [{ application, days: step.days }] : [];
		})
		.sort((a, b) => b.days - a.days)[0];
	if (!waiting) return null;

	const dismiss = () => {
		const next = [...dismissed, waiting.application.id].slice(-200);
		setDismissed(next);
		try {
			window.localStorage.setItem(NUDGE_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Without storage the nudge is dismissed for this visit only.
		}
	};

	const { company } = waiting.application;
	const { days } = waiting;

	return (
		<div
			key={waiting.application.id}
			role="status"
			className={cn(
				ENTER_CLASS,
				"flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-text",
			)}
		>
			<Icon name="schedule" size={20} />
			<span className="min-w-0 flex-1">
				<Trans>
					{company}: no reply for {days} days. A short follow-up is usually fine now.
				</Trans>
			</span>
			<Button size="sm" variant="secondary" onClick={() => onOpen(waiting.application.id)}>
				<Trans>Open</Trans>
			</Button>
			<Button size="icon-sm" variant="ghost" aria-label={t`Dismiss`} onClick={dismiss} className="text-warn-text">
				<Icon name="close" size={18} />
			</Button>
		</div>
	);
}

function EmptyState({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
	return (
		<div className="grid justify-items-center gap-3 py-20 text-center transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0">
			<span className="grid size-12 place-items-center rounded-xl bg-sunken text-ink-2">
				<Icon name="work" size={26} />
			</span>
			<h2 className="text-lg font-semibold">
				<Trans>Track your first job</Trans>
			</h2>
			<p className="max-w-sm text-sm text-ink-2">
				<Trans>Paste a job link. We'll save the posting so Check, the assistant and your letter can use it.</Trans>
			</p>
			<div className="flex gap-2">
				<Button onClick={onAdd}>
					<Icon name="add" />
					<Trans>Save job</Trans>
				</Button>
				<Button variant="secondary" onClick={onImport}>
					<Trans>Import from CSV</Trans>
				</Button>
			</div>
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
