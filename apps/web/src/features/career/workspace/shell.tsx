import type { SavedItem } from "../hooks";
import type { CoachConversation } from "./coach-sheet";
import type { Application } from "@/features/applications/types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { WorkspaceTab } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { m } from "motion/react";
import { useState } from "react";
import { WORKSPACE_TABS } from "@reactive-resume/schema/career";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { useOverlayHistory, useSavedItems } from "../hooks";
import { CountdownChip, Eyebrow, minutesUntil, useCareerTime, useNow } from "../shared";
import { ApplyTab } from "./apply";
import { CoachSheet } from "./coach-sheet";
import { DebriefTab } from "./debrief";
import { FitTab } from "./fit";
import { MessagesTab } from "./messages";
import { PractiseTab } from "./practise";
import { PrepareTab } from "./prepare";
import { SavedTab } from "./saved";
import { ApplicationNotes } from "@/features/applications/components/application-notes";
import { InterviewDialog } from "@/features/applications/components/interview-dialog";
import { buildIcs } from "@/features/applications/ics";
import { formatDuration, interviewKindOf, isInterview } from "@/features/applications/interviews";
import { describeNextStep, getNextStep } from "@/features/applications/next-step";
import { getStageLabel, PIPELINE } from "@/features/applications/stages";
import { D1, EASE } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

export type WorkspaceSearch = {
	coach?: CoachConversation | undefined;
	edit?: "interview" | undefined;
	version?: string | undefined;
	speak?: boolean | undefined;
	story?: string | undefined;
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
	now: Date;
	go: (tab: WorkspaceTab, search?: WorkspaceSearch) => void;
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
			return "fit";
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
	// The round being edited is fixed when the dialog opens; "next interview" can move on while it's open.
	const [editing, setEditing] = useState<{ id: string | null } | null>(null);
	const breakpoint = useBreakpoint();
	const query = useQuery(orpc.applications.getById.queryOptions({ input: { id: applicationId } }));
	const saved = useSavedItems(applicationId);
	const workspace = useQuery(orpc.career.workspace.queryOptions({ input: { applicationId } }));
	const overlay = useOverlayHistory();
	const application = query.data;

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
	const interview = currentInterview(application, now);
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
			search: nextSearch,
			viewTransition: false,
		});
	const setSearch = (patch: WorkspaceSearch, push = false) =>
		void navigate({
			to: "/dashboard/applications/$applicationId/{-$tab}",
			params: { applicationId, tab },
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
	const minutes = interview ? minutesUntil(new Date(interview.at), now) : null;
	const wide = breakpoint === "desktop" || breakpoint === "wide";

	return (
		<div className="flex min-h-svh flex-col">
			<WorkspaceHeader application={application} onAskCoach={() => openSearch({ coach: true })} />
			<div
				className={cn(
					"grid min-h-0 flex-1",
					!wide && "grid-rows-[auto_minmax(0,1fr)]",
					wide && (breakpoint === "wide" ? "grid-cols-[300px_minmax(0,1fr)]" : "grid-cols-[260px_minmax(0,1fr)]"),
				)}
			>
				{wide ? (
					<aside aria-label={t`Application details`} className="grid content-start gap-[22px] border-e border-line p-5">
						<ContextColumn
							application={application}
							interview={interview}
							now={now}
							onEdit={() => openSearch({ edit: "interview" })}
						/>
					</aside>
				) : (
					<details className="group border-b border-line px-4 py-3 md:px-8">
						<summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium">
							<Icon
								name="caret-right"
								size={18}
								className="transition-transform duration-standard ease-enter group-open:rotate-90"
							/>
							<Trans>Details</Trans>
						</summary>
						<div className="grid gap-[22px] pt-4">
							<ContextColumn
								application={application}
								interview={interview}
								now={now}
								onEdit={() => openSearch({ edit: "interview" })}
							/>
						</div>
					</details>
				)}
				<Tabs value={tab} onValueChange={(value) => go(value as WorkspaceTab)} className="min-w-0 gap-0">
					<TabsList
						variant="line"
						className="h-[46px] w-full [scrollbar-width:none] justify-start gap-0 overflow-x-auto px-4 md:px-6 [&_[data-slot=tabs-indicator]]:bg-accent"
					>
						{WORKSPACE_TABS.map((value) => (
							<TabsTrigger key={value} value={value} className="gap-1.5 px-3 data-active:font-semibold">
								{tabLabel(value)}
								{value === "prepare" && minutes !== null && minutes > 0 && minutes < 7 * 24 * 60 && (
									<TabBadge tone={minutes <= 60 ? "warn" : "accent"}>
										{minutes <= 60 ? t`${minutes} min` : t`${Math.round(minutes / 60)} h`}
									</TabBadge>
								)}
								{value === "messages" && unreadMessages > 0 && <TabBadge tone="info">{unreadMessages}</TabBadge>}
								{value === "saved" && (saved.data?.length ?? 0) > 0 && (
									<TabBadge tone="plain">{saved.data?.length}</TabBadge>
								)}
							</TabsTrigger>
						))}
					</TabsList>
					{WORKSPACE_TABS.map((value) => (
						<TabsContent key={value} value={value} className="@container min-w-0 px-4 py-6 md:px-7">
							{value === tab && (
								<m.div
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
														<Trans>This saved version belongs to a different tab. Open it from Saved.</Trans>
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
													<span className="flex-1">
														<Trans>You're looking at a saved version. It can't be edited.</Trans>
													</span>
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
		</div>
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

export const tabLabel = (tab: WorkspaceTab) =>
	({
		fit: t`Fit`,
		apply: t`Apply`,
		prepare: t`Prepare`,
		practise: t`Practise`,
		debrief: t`Debrief`,
		messages: t`Messages`,
		saved: t`Saved`,
	})[tab];

function TabBadge({ tone, children }: { tone: "accent" | "warn" | "info" | "plain"; children: ReactNode }) {
	return (
		<span
			className={cn(
				"inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-medium",
				tone === "accent" && "bg-accent-soft text-accent-text",
				tone === "warn" && "bg-warn-soft text-warn-text",
				tone === "info" && "bg-info-soft text-info-text",
				tone === "plain" && "text-ink-2",
			)}
		>
			{children}
		</span>
	);
}

const stageDot = {
	saved: "bg-stage-saved",
	applied: "bg-stage-applied",
	screening: "bg-stage-screening",
	interview: "bg-stage-interview",
	offer: "bg-stage-offer",
	closed: "bg-stage-closed",
} as const;

type WorkspaceHeaderProps = { application: Application; onAskCoach: () => void };

function WorkspaceHeader({ application, onAskCoach }: WorkspaceHeaderProps) {
	const { date } = useCareerTime();
	const reached = PIPELINE.indexOf(application.status);
	const sent = application.status !== "saved";
	return (
		<header className="grid gap-3 border-b border-line px-4 pt-[22px] pb-4 md:px-8">
			<Link
				to="/dashboard/applications"
				className="flex w-fit items-center gap-1 text-[13px] text-ink-3 transition-colors duration-quick hover:text-ink-2"
			>
				<Icon name="caret-left" size={16} />
				<Trans>Applications</Trans>
			</Link>
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="grid min-w-0 gap-1.5">
					<h1 className="font-display text-2xl leading-8 font-medium md:text-[30px] md:leading-9">
						{application.role} · {application.company}
					</h1>
					<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
						<span className="flex items-center gap-1.5 text-ink">
							<span aria-hidden="true" className={cn("size-2 rounded-full", stageDot[application.status])} />
							{getStageLabel(application.status)}
						</span>
						{application.location && <span>· {application.location}</span>}
						{sent && <span>· {t`Applied ${date(application.appliedAt)}`}</span>}
						{application.sourceUrl && (
							<a
								href={application.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="underline underline-offset-3 hover:text-ink"
							>
								<Trans>View posting</Trans>
							</a>
						)}
					</p>
				</div>
				<div className="flex items-center gap-4">
					{application.status !== "closed" && (
						<div aria-hidden="true" className="hidden gap-1 lg:flex">
							{PIPELINE.map((stage, index) => (
								<span
									key={stage}
									className={cn("h-1.5 w-10 rounded-full", index <= reached ? stageDot[stage] : "bg-line")}
								/>
							))}
						</div>
					)}
					{application.status === "offer" && (
						<Link to="/dashboard/career/offers" className={cn(buttonVariants({ variant: "secondary" }))}>
							<Icon name="scales" size={18} />
							<Trans>Compare offers</Trans>
						</Link>
					)}
					<Button
						className="bg-accent-soft text-accent-text hover:bg-accent-soft hover:brightness-95"
						onClick={onAskCoach}
					>
						<Icon name="sparkle" size={18} />
						<Trans>Ask the coach</Trans>
					</Button>
				</div>
			</div>
		</header>
	);
}

type ContextColumnProps = {
	application: Application;
	interview: InterviewTimelineEntry | undefined;
	now: Date;
	onEdit: () => void;
};

/** NEXT STEP, WHO YOU'LL MEET, WHAT YOU SENT and NOTES: the job at a glance beside every tab. */
function ContextColumn({ application, interview, now, onEdit }: ContextColumnProps) {
	const { i18n } = useLingui();
	const { day, date, time } = useCareerTime();
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const hasSentVersion = Boolean(application.sentResumeVersionId || application.sentCoverLetterVersionId);
	const trashed = useQuery({
		...orpc.documents.list.queryOptions({ input: { trashed: true } }),
		enabled: hasSentVersion,
	});
	const step = getNextStep(application, now);
	const text = describeNextStep(step, application, i18n.locale);
	const upcoming = step.kind === "interview" ? step.interview : interview;
	const soon = upcoming ? minutesUntil(new Date(upcoming.at), now) <= 60 : false;
	const available = [...(documents.data ?? []), ...(trashed.data ?? [])];
	const resume = available.find((document) => document.type === "resume" && document.id === application.resumeId);
	const letter = available.find((document) => document.type === "letter" && document.id === application.coverLetterId);
	const missingDocument = Boolean((application.resumeId && !resume) || (application.coverLetterId && !letter));
	const documentsPending = missingDocument && (documents.isPending || (hasSentVersion && trashed.isPending));
	const documentsFailed = missingDocument && (documents.isError || (hasSentVersion && trashed.isError));
	const sent = application.status !== "saved";

	const addToCalendar = () => {
		if (!upcoming) return;
		const start = new Date(upcoming.at);
		const people = upcoming.participants.map((person) => [person.name, person.role].filter(Boolean).join(", "));
		const ics = buildIcs({
			uid: upcoming.id,
			title: `${interviewKindOf(upcoming.kind)?.label ?? ""} interview · ${application.role}, ${application.company}`,
			start,
			end: new Date(start.getTime() + upcoming.durationMinutes * 60_000),
			...(upcoming.location ? { location: upcoming.location } : {}),
			description: [people.join("\n"), upcoming.notes].filter(Boolean).join("\n\n"),
		});
		downloadWithAnchor(
			new Blob([ics], { type: "text/calendar" }),
			`${application.company}-interview.ics`.replace(/[^\w.-]+/g, "-"),
		);
	};

	return (
		<>
			<section className="grid gap-2">
				<Eyebrow>
					<Trans>Next step</Trans>
				</Eyebrow>
				<div
					className={cn(
						"grid gap-2.5 rounded-xl border p-3.5 transition-colors duration-standard",
						soon ? "border-warn bg-warn-soft/40" : "border-line bg-surface",
					)}
				>
					<div className="flex gap-2.5">
						<Icon name={upcoming ? "calendar-dot" : text.icon} className="mt-px shrink-0 text-ink-2" />
						<div className="grid min-w-0 gap-0.5">
							<p className="text-sm font-semibold">
								{upcoming ? t`${interviewKindOf(upcoming.kind)?.label ?? ""} interview` : text.title}
							</p>
							{upcoming ? (
								<>
									<p className="text-[13px] text-ink-2">
										{day(upcoming.at)} · {time(upcoming.at)} · {formatDuration(upcoming.durationMinutes, i18n.locale)}
									</p>
									{upcoming.location && <p className="text-xs text-ink-3">{upcoming.location}</p>}
								</>
							) : (
								text.sub && <p className="text-[13px] text-ink-2">{text.sub}</p>
							)}
						</div>
					</div>
					{upcoming && <CountdownChip at={new Date(upcoming.at)} now={now} />}
					<div className="flex flex-wrap gap-1.5">
						<Button size="sm" variant="secondary" onClick={onEdit}>
							{upcoming ? <Trans>Edit</Trans> : <Trans>Add an interview</Trans>}
						</Button>
						{upcoming && (
							<Button size="sm" variant="ghost" onClick={addToCalendar}>
								<Icon name="calendar-plus" size={16} />
								<Trans>Add to calendar</Trans>
							</Button>
						)}
					</div>
				</div>
			</section>

			{upcoming && upcoming.participants.length > 0 && (
				<section className="grid gap-2.5">
					<Eyebrow>
						<Trans>Who you'll meet</Trans>
					</Eyebrow>
					{upcoming.participants.map((person) => (
						<div key={`${person.name}-${person.role}`} className="flex items-center gap-2.5">
							<span className="grid size-[30px] shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink-2">
								{getInitials(person.name)}
							</span>
							<div className="grid min-w-0">
								<span className="truncate text-[13px] font-semibold">{person.name}</span>
								{person.role && <span className="truncate text-xs text-ink-3">{person.role}</span>}
							</div>
						</div>
					))}
				</section>
			)}
			{upcoming?.notes && (
				<section className="grid gap-2.5">
					<Eyebrow>
						<Trans>Interview notes</Trans>
					</Eyebrow>
					<p className="rounded-lg bg-sunken px-3 py-2.5 text-[13px] leading-[19px] whitespace-pre-wrap text-ink-2">
						{upcoming.notes}
					</p>
				</section>
			)}

			{(resume || letter || documentsPending || documentsFailed) && (
				<section className="grid gap-2">
					<Eyebrow>
						{sent ? (
							<Trans>What you sent · {date(application.appliedAt)}</Trans>
						) : (
							<Trans>Documents for this job</Trans>
						)}
					</Eyebrow>
					{documentsPending ? (
						<p role="status" className="text-xs text-ink-3">
							<Trans>Loading linked documents…</Trans>
						</p>
					) : documentsFailed ? (
						<div className="grid justify-items-start gap-1.5">
							<p role="alert" className="text-xs text-ink-3">
								<Trans>Linked documents couldn't be loaded.</Trans>
							</p>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									void documents.refetch();
									if (hasSentVersion) void trashed.refetch();
								}}
							>
								<Trans>Try again</Trans>
							</Button>
						</div>
					) : null}
					{resume && application.resumeId && (
						<Link
							to="/builder/$resumeId"
							params={{ resumeId: application.resumeId }}
							search={application.sentResumeVersionId ? { version: application.sentResumeVersionId } : {}}
							className="flex items-center gap-2.5 rounded-xl border border-line p-3 transition-colors duration-quick hover:bg-hover"
						>
							<Icon name="file-text" className="shrink-0 text-ink-2" />
							<span className="grid min-w-0">
								<span className="truncate text-[13px] font-semibold">{resume.name}</span>
								<span className="text-xs text-ink-3">
									{application.sentResumeVersionId ? (
										<Trans>Resume · version sent</Trans>
									) : (
										<Trans>Resume · not sent yet</Trans>
									)}
								</span>
							</span>
						</Link>
					)}
					{letter && application.coverLetterId && (
						<Link
							to="/builder/letter/$coverLetterId"
							params={{ coverLetterId: application.coverLetterId }}
							search={application.sentCoverLetterVersionId ? { version: application.sentCoverLetterVersionId } : {}}
							className="flex items-center gap-2.5 rounded-xl border border-line p-3 transition-colors duration-quick hover:bg-hover"
						>
							<Icon name="envelope-simple" className="shrink-0 text-ink-2" />
							<span className="grid min-w-0">
								<span className="truncate text-[13px] font-semibold">{letter.name}</span>
								<span className="text-xs text-ink-3">
									{application.sentCoverLetterVersionId ? (
										<Trans>Letter · version sent</Trans>
									) : (
										<Trans>Letter · not sent yet</Trans>
									)}
								</span>
							</span>
						</Link>
					)}
				</section>
			)}

			<section className="grid gap-1.5">
				<ApplicationNotes key={application.id} application={application} />
				<p className="text-xs text-ink-3">
					<Trans>The coach reads these for this application only.</Trans>
				</p>
			</section>
		</>
	);
}
