import type { SavedItem } from "../hooks";
import type { CoachConversation } from "./coach-sheet";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { m } from "motion/react";
import { useState } from "react";
import { WORKSPACE_TABS } from "@reactive-resume/schema/career";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Tabs, TabsContent } from "@reactive-resume/ui/components/tabs";
import { cn } from "@reactive-resume/utils/style";
import { latest, useOverlayHistory, useSavedItems } from "../hooks";
import { tabLabel, useCareerTime, useNow } from "../shared";
import { ApplyTab } from "./apply";
import { CoachSheet } from "./coach-sheet";
import { DebriefTab } from "./debrief";
import { FitTab } from "./fit";
import { MessagesTab } from "./messages";
import { ApplicationOverview, workspaceIcons } from "./overview";
import { PractiseTab } from "./practise";
import { PrepareTab } from "./prepare";
import { SavedTab } from "./saved";
import { Crumb, CrumbLink } from "@/components/calm/crumb";
import { Page, PageBody } from "@/components/calm/page";
import { SectionRail, SectionRailItem } from "@/components/calm/section-rail";
import { StageDot } from "@/components/calm/stage-dot";
import { ApplicationDetailSheet } from "@/features/applications/components/application-detail-sheet";
import { ApplicationFormSheet } from "@/features/applications/components/application-form-sheet";
import { InterviewDialog } from "@/features/applications/components/interview-dialog";
import { isInterview } from "@/features/applications/interviews";
import { getStageLabel } from "@/features/applications/stages";
import { D1, EASE } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

export type WorkspaceSearch = {
	coach?: CoachConversation | undefined;
	details?: boolean | undefined;
	edit?: "interview" | undefined;
	version?: string | undefined;
	speak?: boolean | undefined;
	story?: string | undefined;
	warmup?: boolean | undefined;
	/** Messages opens with the offer form ("Add the offer's terms"). */
	offer?: "new" | undefined;
	/** The interview round to work on, when a link names one (a later round of the same application). */
	round?: string | undefined;
};

/** What every tab receives: the application, and a saved version to show read-only ("Open in Prepare"). */
export type WorkspaceTabProps = {
	application: Application;
	/** A saved item opened from Saved: the tab shows it read-only with "Back to current". */
	version: SavedItem | undefined;
	/** The next interview still to come, or the most recent one if it just ended. */
	interview: InterviewTimelineEntry | undefined;
	/** Practise: open with Speak selected. */
	speak: boolean;
	story?: string | undefined;
	warmup?: boolean | undefined;
	now: Date;
	go: (tab: WorkspaceTab, search?: WorkspaceSearch) => void;
	/** Messages: open the offer form at once, then forget the request once it closes. */
	offerForm?: { open: boolean; onDone: () => void } | undefined;
};

const DAY = 86_400_000;
const archiveKinds = {
	fit: "fit",
	apply: "answers",
	prepare: "briefing",
	practise: "practice",
	debrief: "debrief",
	messages: "reply",
	saved: null,
} satisfies Record<WorkspaceTab, SavedItem["data"]["kind"] | null>;

/** The interview a workspace is about: the next one to come, else the latest one if it ended in the last day. */
function currentInterview(application: Application, now: Date) {
	const interviews = application.activity.filter(isInterview).sort((a, b) => +new Date(a.at) - +new Date(b.at));
	const end = (interview: InterviewTimelineEntry) => +new Date(interview.at) + interview.durationMinutes * 60_000;
	return (
		interviews.find((interview) => end(interview) >= +now) ??
		interviews.filter((interview) => +now - end(interview) < DAY).at(-1)
	);
}

/** Rule 7: the tab a stage opens on. Offers are compared in Career, so an offer opens on its messages. */
function defaultTab(application: Application, now: Date): WorkspaceTab {
	const interview = currentInterview(application, now);
	const ended = interview && +new Date(interview.at) + interview.durationMinutes * 60_000 < +now;
	switch (application.status) {
		case "saved":
			return "apply";
		case "applied":
			return "apply";
		case "screening":
		case "interview":
			return ended ? "debrief" : "prepare";
		case "offer":
			return "messages";
		case "closed":
			return "saved";
	}
}

type WorkspaceProps = {
	applicationId: string;
	tab: WorkspaceTab | undefined;
	search: WorkspaceSearch;
};

export function Workspace({ applicationId, tab: requested, search }: WorkspaceProps) {
	const navigate = useNavigate();
	const now = useNow();
	const time = useCareerTime();
	// The round being edited is fixed when the dialog opens; "next interview" can move on while it's open.
	const [editing, setEditing] = useState<{ id: string | null } | null>(null);
	const [editDetails, setEditDetails] = useState<Application | null>(null);
	const query = useQuery(orpc.applications.getById.queryOptions({ input: { id: applicationId } }));
	const saved = useSavedItems(applicationId);
	// Items being deleted (Undo still offered) are already gone from the list: leave them out of the badge too.
	const workspace = useQuery(orpc.career.workspace.queryOptions({ input: { applicationId } }));
	const overlay = useOverlayHistory();
	const application = query.data;
	const offer = latest(saved.data, "offer");

	if (query.isPending)
		return (
			<div className="grid min-h-svh place-items-center">
				<Spinner />
			</div>
		);
	if (!application)
		return (
			<div className="grid min-h-svh place-content-center justify-items-center gap-3 p-6 text-center">
				<p role="alert" className="font-display text-[22px] leading-7">
					<Trans>This application couldn't be opened.</Trans>
				</p>
				<Link to="/dashboard/applications" className={cn(buttonVariants({ variant: "secondary" }))}>
					<Trans>Back to applications</Trans>
				</Link>
			</div>
		);

	const tab = requested ?? defaultTab(application, now);
	// A link to a later round names it; otherwise the next one to come.
	const named = search.round
		? application.activity.find(
				(entry): entry is InterviewTimelineEntry => isInterview(entry) && entry.id === search.round,
			)
		: undefined;
	const interview = search.warmup && search.round ? named : (named ?? currentInterview(application, now));
	const version = search.version ? saved.data?.find((item) => item.id === search.version) : undefined;
	const archived = search.version !== undefined;
	const archiveUnavailable = archived && (!version || version.data.kind !== archiveKinds[tab]);
	const waiting = saved.isPending || (!archived && tab !== "saved" && workspace.isPending);
	const failed =
		(saved.isError && saved.data === undefined) ||
		(!archived && tab !== "saved" && workspace.isError && workspace.data === undefined);
	const blocked = waiting || failed || archiveUnavailable;
	// Tabs fade their own panel in (120ms), so the page-wide view transition would only add a second fade.
	const go = (next: WorkspaceTab, nextSearch: WorkspaceSearch = {}) =>
		void navigate({
			to: "/dashboard/applications/$applicationId/{-$tab}",
			params: { applicationId, tab: next },
			// The chosen round stays chosen from tab to tab.
			search: { ...(search.round ? { round: search.round } : {}), ...nextSearch },
			viewTransition: false,
		});
	const setSearch = (patch: WorkspaceSearch, push = false) =>
		void navigate({
			to: "/dashboard/applications/$applicationId/{-$tab}",
			params: { applicationId, tab: requested },
			search: { ...search, ...patch },
			replace: !push,
		});
	const openSearch = (patch: WorkspaceSearch) => {
		overlay.open();
		setSearch(patch, true);
	};
	const closeSearch = (patch: WorkspaceSearch) => overlay.close(() => setSearch(patch));
	const props: WorkspaceTabProps = {
		application,
		version,
		interview,
		now,
		go,
		speak: search.speak === true,
		story: search.story,
		warmup: search.warmup === true,
		offerForm: { open: search.offer === "new", onDone: () => setSearch({ offer: undefined }) },
	};
	// Messages shows the newest read message: it waits for a decision while its changes aren't applied.
	const newestReply = saved.data?.find((item) => item.data.kind === "reply");
	const unreadMessages =
		newestReply?.data.kind === "reply" && newestReply.data.changes.length > 0 && !newestReply.data.applied ? 1 : 0;
	const editOpen = search.edit === "interview";
	if (editOpen && !editing) setEditing({ id: interview?.id ?? null });
	if (!editOpen && editing) setEditing(null);
	const editingId = editing ? editing.id : (interview?.id ?? null);
	const editingInterview = application.activity.filter(isInterview).find((entry) => entry.id === editingId);
	return (
		<Page className="h-svh flex-none overflow-y-auto">
			<PageBody className={!requested ? "pb-0" : undefined}>
				<div className="flex min-h-7 items-center justify-between gap-3">
					<Crumb>
						<CrumbLink to="/dashboard/applications">
							<Trans>Applications</Trans>
						</CrumbLink>
						{requested && (
							<Link to="/dashboard/applications/$applicationId/{-$tab}" params={{ applicationId }}>
								{application.company}
							</Link>
						)}
					</Crumb>
					<Button size="sm" variant="ghost" className="-me-2.5" onClick={() => openSearch({ coach: true })}>
						<Icon name="sparkle" />
						<Trans>Ask the coach</Trans>
					</Button>
				</div>
				{!requested ? (
					<ApplicationOverview
						application={application}
						interview={interview}
						now={now}
						saved={saved.data ?? []}
						savedPending={saved.isPending}
						savedFailed={saved.isError}
						onRetrySaved={() => void saved.refetch()}
						go={go}
						onDetails={() => openSearch({ details: true })}
						detailsOpen={Boolean(search.details)}
						onEdit={() => openSearch({ edit: "interview" })}
					/>
				) : (
					<div className="mt-3 flex min-w-0 flex-col items-start gap-6 lg:flex-row lg:gap-12">
						<div className="w-full shrink-0 lg:w-[200px]">
							<Link
								to="/dashboard/applications/$applicationId/{-$tab}"
								params={{ applicationId }}
								className="mb-4 hidden gap-0.5 px-2.5 pt-1 lg:grid"
							>
								<span className="t-label">{application.company}</span>
								<span className="flex items-center gap-1.5 text-[13px]/[18px] text-ink-3">
									<StageDot status={application.status}>{null}</StageDot>
									{application.status === "saved"
										? t`Saved · not applied yet`
										: application.status === "offer" && offer?.data.respondBy
											? t`Offer · reply by ${time.format(offer.data.respondBy, { weekday: "short", day: "numeric", month: "short" })}`
											: interview
												? t`${getStageLabel(application.status)} · ${new Intl.DateTimeFormat(i18n.locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date(interview.at))}`
												: application.status === "applied"
													? t`Applied · ${new Intl.DateTimeFormat(i18n.locale, { day: "numeric", month: "short" }).format(new Date(application.appliedAt))}`
													: getStageLabel(application.status)}
								</span>
							</Link>
							<SectionRail aria-label={t`Application workspace`}>
								{WORKSPACE_TABS.map((value) => (
									<SectionRailItem
										key={value}
										icon={workspaceIcons[value]}
										to="/dashboard/applications/$applicationId/{-$tab}"
										params={{ applicationId, tab: value }}
										search={search.round ? { round: search.round } : {}}
									>
										{tabLabel(value)}
										{value === "messages" && unreadMessages > 0 && (
											<span className="text-xs text-ink-3">{unreadMessages}</span>
										)}
									</SectionRailItem>
								))}
							</SectionRail>
						</div>
						<Tabs value={tab} className="min-w-0 flex-1 gap-0">
							{WORKSPACE_TABS.map((value) => (
								<TabsContent key={value} value={value} className="@container min-w-0">
									{value === tab && (
										<m.div
											className="relative"
											initial={{ opacity: 0, transform: "translateY(4px)" }}
											animate={{ opacity: 1, transform: "translateY(0px)" }}
											transition={{ duration: D1, ease: EASE }}
										>
											{blocked ? (
												<div className="grid justify-items-start gap-3 rounded-xl border border-line p-5">
													{waiting ? (
														<p role="status" className="flex items-center gap-2 text-sm text-ink-2">
															<Spinner decorative />
															{archived ? <Trans>Loading saved version…</Trans> : <Trans>Loading workspace…</Trans>}
														</p>
													) : (
														<p role="alert" className="text-sm text-ink-2">
															{failed ? (
																archived ? (
																	<Trans>This saved version couldn't be loaded.</Trans>
																) : (
																	<Trans>This workspace couldn't be loaded.</Trans>
																)
															) : version ? (
																<Trans>This saved version belongs to a different tab. Open it from Library.</Trans>
															) : (
																<Trans>This saved version is no longer available.</Trans>
															)}
														</p>
													)}
													<div className="flex flex-wrap gap-2">
														{failed && (
															<Button
																size="sm"
																variant="secondary"
																onClick={() => {
																	void saved.refetch();
																	if (!archived) void workspace.refetch();
																}}
															>
																<Trans>Try again</Trans>
															</Button>
														)}
														{archived && (
															<Button size="sm" variant="secondary" onClick={() => setSearch({ version: undefined })}>
																<Trans>Back to current</Trans>
															</Button>
														)}
													</div>
												</div>
											) : (
												<>
													{version && (
														<div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-sunken px-3.5 py-2.5 text-sm">
															<Icon name="clock-counter-clockwise" size={18} className="text-ink-3" />
															<span className="flex-1">{t`Saved ${time.when(version.createdAt)} · read-only`}</span>
															<Button size="sm" variant="secondary" onClick={() => setSearch({ version: undefined })}>
																<Trans>Back to current</Trans>
															</Button>
														</div>
													)}
													<TabBody tab={value} {...props} />
												</>
											)}
										</m.div>
									)}
								</TabsContent>
							))}
						</Tabs>
					</div>
				)}
			</PageBody>
			<ApplicationDetailSheet
				application={search.details && !editDetails ? application : null}
				onOpenChange={(open) => !open && closeSearch({ details: undefined })}
				onEditDetails={setEditDetails}
				returnFocus={() => document.querySelector<HTMLElement>("[data-details-trigger]")}
			/>
			<ApplicationFormSheet
				open={!!editDetails}
				application={editDetails}
				onOpenChange={(open) => !open && setEditDetails(null)}
			/>
			<CoachSheet
				application={application}
				tab={tab}
				conversation={search.coach}
				onConversationChange={(coach) =>
					coach === undefined
						? closeSearch({ coach })
						: search.coach === undefined
							? openSearch({ coach })
							: setSearch({ coach })
				}
			/>
			<InterviewDialog
				application={application}
				interview={editOpen ? (editingInterview ?? null) : null}
				open={search.edit === "interview"}
				onOpenChange={(open) => (open ? openSearch({ edit: "interview" }) : closeSearch({ edit: undefined }))}
			/>
		</Page>
	);
}

function TabBody({ tab, ...props }: WorkspaceTabProps & { tab: WorkspaceTab }) {
	switch (tab) {
		case "fit":
			return <FitTab {...props} />;
		case "apply":
			return <ApplyTab {...props} />;
		case "prepare":
			return <PrepareTab {...props} />;
		case "practise":
			return <PractiseTab {...props} />;
		case "debrief":
			return <DebriefTab {...props} />;
		case "messages":
			return <MessagesTab {...props} />;
		case "saved":
			return <SavedTab {...props} />;
	}
}
