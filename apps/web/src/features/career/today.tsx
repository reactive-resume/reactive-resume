import type { Kind, Lead, Schedule } from "./schedule-sheet";
import type { ApplicationSummary } from "@/features/applications/types";
import type { RouterOutput } from "@/libs/orpc/client";
import type { NextStep } from "@reactive-resume/schema/applications/next-step";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactElement, ReactNode } from "react";
import { i18n } from "@lingui/core";
import { ph, plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useId, useState } from "react";
import { latestOfferHints } from "@reactive-resume/schema/applications/next-step";
import { applicationSentAt } from "@reactive-resume/schema/applications/outcomes";
import { upcomingApplicationEvents } from "@reactive-resume/schema/applications/upcoming";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError } from "./load-state";
import { useApplicationsNeedingAttention } from "./needs-you";
import { rollForward, ScheduleSheet, scheduleKind } from "./schedule-sheet";
import { CollapseRow, useCareerTime, useNow, withQueryUndo } from "./shared";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { HeroCard } from "@/components/calm/hero-card";
import { DateColumn, IconTile, List, ListRow, rowLinkClassName } from "@/components/calm/list-row";
import { Columns } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
import { interviewCalendarAction } from "@/features/applications/calendar";
import { interviewStepTitle } from "@/features/applications/next-step";
import { applicationsListQueryOptions, savedOffersQueryOptions } from "@/features/applications/queries";
import { useApplicationActions } from "@/features/applications/use-application-actions";
import { DocumentStatusBadge } from "@/features/documents/document-status";
import { DropToImport } from "@/features/documents/documents-page";
import { formatEdited } from "@/features/documents/filter";
import { useStartDocument } from "@/features/documents/use-start-document";
import { useShortcutsPage } from "@/features/keyboard-shortcuts/store";
import { useSaveTimezone } from "@/features/settings/use-save-timezone";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

type Notification = RouterOutput["career"]["notifications"][number];
type Opportunity = RouterOutput["career"]["opportunities"][number];

type TodayPageProps = { schedule: string | undefined; onScheduleChange: (schedule: string | undefined) => void };

/** Calendar days from `now` to `value` in the account's timezone: 0 today, 1 tomorrow, -1 yesterday. */
function useDayDistance() {
	const { timeZone } = useCareerTime();
	// en-CA writes the calendar date as YYYY-MM-DD, which parses as that day's UTC midnight.
	const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
	return (value: Date | string, now: Date) => {
		const key = (date: Date | string) => Date.parse(ymd.format(new Date(date)));
		return Math.round((key(value) - key(now)) / 86_400_000);
	};
}

/** "today, 07:00", "yesterday, 18:02", else "Wed 4 Nov": when a schedule's result arrived. */
function useStamp() {
	const { time, day, locale } = useCareerTime();
	const distance = useDayDistance();
	return (value: Date | string, now: Date) => {
		const days = distance(value, now);
		if (days !== 0 && days !== -1) return day(value);
		return `${new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day")}, ${time(value)}`;
	};
}

/**
 * Today, the home page. Resting (T1): the next interview leads as the hero; Needs you, New roles and the last documents
 * on the left, Coming up on the right. When schedules have produced something unread (C11), those results lead
 * instead, with Needs you and the schedules beside them. A new account (E1) gets the first-run hero.
 */
export function TodayPage({ schedule, onScheduleChange }: TodayPageProps) {
	useShortcutsPage(t`Today`);
	const { session } = useRouteContext({ strict: false });
	const now = useNow();
	const queryClient = useQueryClient();
	const notifications = useQuery(orpc.career.notifications.queryOptions({ input: {} }));
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { sort: "edited", limit: 2 } }));
	const applications = useQuery(applicationsListQueryOptions());
	const [showRead, setShowRead] = useState(false);
	const [pending, setPending] = useState<string[]>([]);
	// Deleted schedules stay hidden locally until the Undo toast closes; any mutation refetches every query.
	const [deleted, setDeleted] = useState<string[]>([]);

	const deleteSchedule = (id: string) => {
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.schedules.key(),
			description: t`Schedule deleted`,
			errorMessage: t`Couldn't delete this schedule. Try again.`,
			prepare: () => prepareRpc(client.career.deleteSchedule, { id }),
			hide: () => setDeleted((current) => [...current, id]),
			restore: () => setDeleted((current) => current.filter((item) => item !== id)),
		});
	};

	const sheet = (
		<ScheduleSheet
			key={session?.user.id}
			schedule={schedule}
			onScheduleChange={onScheduleChange}
			onDelete={deleteSchedule}
		/>
	);

	if (notifications.isError || documents.isError || applications.isError)
		return (
			<div className="pt-5">
				<CareerLoadError
					onRetry={() => {
						void notifications.refetch();
						void documents.refetch();
						void applications.refetch();
					}}
				/>
				{sheet}
			</div>
		);
	if (!notifications.data || !documents.data || !applications.data)
		return (
			<div className="flex flex-col gap-4 pt-5">
				<Skeleton className="h-50 rounded-xl" />
				<Skeleton className="h-64 rounded-xl xl:me-[408px]" />
				{sheet}
			</div>
		);

	const isUnread = (row: Notification) => !row.readAt && !pending.includes(row.id);
	const unread = notifications.data.filter(isUnread);
	const results = showRead ? notifications.data.filter((row) => !pending.includes(row.id)) : unread;
	const readCount = notifications.data.length - unread.length;

	if (documents.data.length === 0 && applications.data.length === 0 && notifications.data.length === 0)
		return (
			<>
				<FirstRun />
				{sheet}
			</>
		);

	const resultsLead = results.length > 0;

	return (
		<>
			{!resultsLead && <InterviewHero now={now} />}
			{resultsLead ? (
				<Columns
					className="mt-1"
					aside={
						<>
							<NeedsYou now={now} compact first />
							<SchedulesPanel deleted={deleted} onOpenSchedule={onScheduleChange} />
						</>
					}
				>
					<ScheduleResults
						rows={results}
						unread={unread.length}
						readCount={readCount}
						showRead={showRead}
						onShowRead={setShowRead}
						isUnread={isUnread}
						now={now}
						onHide={(id) => setPending((current) => [...current, id])}
						onRestore={(id) => setPending((current) => current.filter((item) => item !== id))}
					/>
					<NewRoles now={now} selecting accent />
				</Columns>
			) : (
				<div className="grid items-start gap-x-12 xl:grid-cols-[minmax(0,1fr)_360px]">
					<div className="min-w-0">
						<NeedsYou now={now} readCount={readCount} onShowRead={() => setShowRead(true)} />
					</div>
					<aside className="min-w-0 xl:col-start-2 xl:row-span-2 xl:row-start-1">
						<ComingUp now={now} />
					</aside>
					<div className="min-w-0 xl:col-start-1">
						<NewRoles now={now} selecting={false} accent={false} />
						<PickUp documents={documents.data} />
					</div>
				</div>
			)}
			{sheet}
		</>
	);
}

/** "times in Lisbon · this device is on Berlin time · Use Berlin time": said once, under the date, when they differ. */
export function TodayTimezoneNote() {
	const { timeZone, deviceTimeZone } = useCareerTime();
	const save = useSaveTimezone();
	const [saving, setSaving] = useState(false);
	if (!deviceTimeZone) return null;
	const city = (zone: string) => zone.split("/").at(-1)?.replaceAll("_", " ") ?? zone;
	const account = city(timeZone);
	const device = city(deviceTimeZone);
	return (
		<>
			{" · "}
			<Trans>
				times in {account} · this device is on {device} time
			</Trans>{" "}
			<button
				type="button"
				disabled={saving}
				className="touch-target relative font-medium text-accent-text hover:underline disabled:opacity-50"
				onClick={() => {
					setSaving(true);
					void save(deviceTimeZone).finally(() => setSaving(false));
				}}
			>
				<Trans>Use {device} time</Trans>
			</button>
		</>
	);
}

// ---- Hero: the next interview ----

// calm: request to lead — Button size="lg" sets no line height; the boards draw its label on a 20px line.
const LG = "leading-5";

function InterviewHero({ now }: { now: Date }) {
	const { format, plainTime, locale, timeZone } = useCareerTime();
	const distance = useDayDistance();
	const applications = useQuery(applicationsListQueryOptions());
	const offers = useQuery(savedOffersQueryOptions());
	const briefings = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "briefing" } }));
	const interviews = upcomingApplicationEvents(
		applications.data ?? [],
		offers.data ? latestOfferHints(offers.data) : undefined,
		now,
		timeZone,
	).flatMap((event) => (event.kind === "interview" && distance(event.at, now) <= 7 ? [event] : []));
	const ready = (id: string) => briefings.data?.some((item) => item.interviewId === id) ?? false;
	// The interview you're ready for leads; otherwise the soonest one.
	const next = interviews.find((event) => ready(event.interview.id)) ?? interviews[0];
	if (!next) return null;

	const { application, interview, at } = next;
	const hasBriefing = ready(interview.id);
	const days = distance(at, now);
	const when = `${format(at, { weekday: "long", day: "numeric", month: "short" })}, ${plainTime(at)}`;
	const inDays = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day");
	const calendar = interviewCalendarAction(application, interview, "PUBLISH", getAccountGeneration());
	const company = application.company;
	const kind = interviewStepTitle(interview.kind);

	return (
		<HeroCard
			className="mt-5"
			kicker={
				<StageDot status={application.status} className="flex w-full gap-2">
					{t`Interview · ${when} · ${inDays}`}
				</StageDot>
			}
			title={t`${kind} at ${company}`}
			actions={
				<>
					<Button
						size="lg"
						// The actions share a line while they fit and wrap when they don't (German, M4).
						className={LG}
						nativeButton={false}
						render={
							<Link
								to="/dashboard/applications/$applicationId/{-$tab}"
								params={{ applicationId: application.id, tab: "prepare" }}
								search={{ round: interview.id }}
							/>
						}
					>
						{hasBriefing ? <Trans>Open briefing</Trans> : <Trans>Prepare</Trans>}
					</Button>
					<Button size="lg" variant="ghost" className={LG} onClick={calendar.onClick}>
						<Icon name="calendar-plus" />
						<Trans>Add to calendar</Trans>
					</Button>
				</>
			}
		>
			{hasBriefing ? (
				<Trans>Your briefing is ready: likely questions, who you'll meet and three stories to tell.</Trans>
			) : (
				<Trans>Get ready in the workspace: likely questions, who you'll meet and stories to tell.</Trans>
			)}
		</HeroCard>
	);
}

// ---- Needs you ----

/** What the next step asks of you, in Today's words: "Reply to Parcel & Co." / "Offer · by Friday 13 Nov". */
function useNeedLine() {
	const { format } = useCareerTime();
	return (application: ApplicationSummary, step: NextStep, compact: boolean) => {
		const company = application.company;
		const sentAt = applicationSentAt(application);
		const sent = sentAt ? format(sentAt, { day: "numeric", month: "short" }) : null;
		const long = (value: Date) => format(value, { weekday: "long", day: "numeric", month: "short" });
		if (step.kind === "offer") {
			const by = step.respondBy ? long(step.respondBy) : null;
			return {
				title: t`Reply to ${company}`,
				subtitle: !by ? t`Offer` : step.overdue ? t`Offer · was due ${by}` : t`Offer · by ${by}`,
			};
		}
		if (step.kind === "follow-up" || step.kind === "no-reply") {
			const overdue = step.kind === "no-reply" || step.overdue;
			const due = step.kind === "follow-up" ? long(step.at) : "";
			return {
				title: compact ? t`Follow up with ${company}` : t`Send a follow-up to ${company}`,
				subtitle: !overdue
					? due
					: !sent
						? t`Overdue`
						: compact
							? t`Overdue · applied ${sent}`
							: t`Overdue · applied ${sent}, no reply yet`,
			};
		}
		return { title: company, subtitle: application.role };
	};
}

type NeedsYouProps = {
	now: Date;
	compact?: boolean;
	first?: boolean;
	/** Resting Today with nothing owed and nothing new: the caught-up block offers the read results back. */
	readCount?: number;
	onShowRead?: () => void;
};

/** The steps you owe on your applications: replies to offers and follow-ups. Interviews are in Coming up. */
function NeedsYou({ now, compact = false, first = false, readCount = 0, onShowRead }: NeedsYouProps) {
	const { attention: owed } = useApplicationsNeedingAttention(now);
	// Offers lead: they carry a deadline the other side set. The rest keep Applications' order.
	const attention = owed.toSorted((a, b) => Number(b.step.kind === "offer") - Number(a.step.kind === "offer"));
	const actions = useApplicationActions();
	const line = useNeedLine();
	// Phones keep the whole title and its line, one caret: the row opens Messages to draft a note, and Done stays on the application's row in Applications.
	const phone = useBreakpoint() === "mobile";

	return (
		<section aria-labelledby="needs-you">
			<SectionHeading
				id="needs-you"
				className={first ? "pt-5" : undefined}
				note={attention.length ? i18n.number(attention.length) : undefined}
			>
				<Trans>Needs you</Trans>
			</SectionHeading>
			{attention.length === 0 ? (
				compact || !onShowRead ? (
					<EmptyState variant="compact" title={<Trans>You're up to date</Trans>} />
				) : (
					<EmptyState
						title={<Trans>You're up to date</Trans>}
						description={<Trans>New roles, reminders and finished briefings appear here.</Trans>}
						action={
							readCount > 0 && (
								<Button variant="ghost" onClick={onShowRead}>
									<Trans>Show {i18n.number(readCount)} read</Trans>
								</Button>
							)
						}
					/>
				)
			) : (
				<List>
					{attention.map(({ application, step }) => {
						const { title, subtitle } = line(application, step, compact);
						const leading = <StageDot status={application.status}>{null}</StageDot>;
						if (step.kind === "offer" || compact || phone)
							return (
								<ListRow
									key={application.id}
									leading={leading}
									title={title}
									subtitle={subtitle}
									caret
									render={
										step.kind === "offer" ? (
											<Link to="/dashboard/career/offers" />
										) : (
											<Link
												to="/dashboard/applications/$applicationId/{-$tab}"
												params={{ applicationId: application.id, tab: "messages" }}
											/>
										)
									}
								/>
							);
						return (
							<ListRow key={application.id} interactive leading={leading}>
								<span className="flex min-w-0 flex-1 flex-col gap-px">
									<Link
										to="/dashboard/applications/$applicationId/{-$tab}"
										params={{ applicationId: application.id, tab: "messages" }}
										className={cn("truncate t-row-title", rowLinkClassName)}
									>
										{title}
									</Link>
									<span className="truncate text-[13px]/[18px] text-ink-3">{subtitle}</span>
								</span>
								<HoverActions>
									<Button
										size="sm"
										variant="ghost"
										disabled={actions.logFollowUp.isPending}
										onClick={() => actions.logFollowUp.mutate({ id: application.id })}
									>
										<Trans>Done</Trans>
									</Button>
									<Button
										size="sm"
										variant="secondary"
										nativeButton={false}
										render={
											<Link
												to="/dashboard/applications/$applicationId/{-$tab}"
												params={{ applicationId: application.id, tab: "messages" }}
											/>
										}
									>
										<Trans>Draft a note</Trans>
									</Button>
								</HoverActions>
								<RowCaret />
							</ListRow>
						);
					})}
				</List>
			)}
		</section>
	);
}

/** Row controls that take the caret's place on hover and keyboard focus; touch screens always show them. */
function HoverActions({ children }: { children: ReactNode }) {
	return (
		<span className="relative z-10 hidden shrink-0 items-center gap-3.5 group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
			{children}
		</span>
	);
}

function RowCaret() {
	return (
		<Icon
			name="caret-right"
			size={18}
			className="shrink-0 text-ink-3 group-focus-within/row:hidden group-hover/row:hidden pointer-coarse:hidden"
		/>
	);
}

/**
 * A list row in its own animated wrapper is that wrapper's last child, so the row's own `last:` rule would drop every
 * hairline: the wrapper puts it back between rows and keeps it off the list's last row.
 */
const COLLAPSE_ROW = "-mx-3 px-3 [&:last-child>*]:border-b-0 [&:not(:last-child)>*:last-child]:border-b";

// ---- From your schedules ----

const resultKind = (kind: Notification["notice"]["type"]): { icon: IconName; source: string; action: string } => {
	if (kind === "opportunities") return { icon: "globe-simple", source: t`Role discovery`, action: t`Review` };
	if (kind === "followup") return { icon: "envelope-simple", source: t`Follow-up reminder`, action: t`Review draft` };
	if (kind === "briefing")
		return { icon: "clipboard-text", source: t`Interview preparation`, action: t`Open briefing` };
	return { icon: "warning-circle", source: t`Schedules`, action: t`Open` };
};

type ScheduleResultsProps = {
	rows: Notification[];
	unread: number;
	readCount: number;
	showRead: boolean;
	onShowRead: (show: boolean) => void;
	isUnread: (row: Notification) => boolean;
	now: Date;
	onHide: (id: string) => void;
	onRestore: (id: string) => void;
};

/** Each finished run is one row: what it made, which schedule and when, and one way in. The tick marks it read. */
function ScheduleResults({
	rows,
	unread,
	readCount,
	showRead,
	onShowRead,
	isUnread,
	now,
	onHide,
	onRestore,
}: ScheduleResultsProps) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const stamp = useStamp();
	const queryKey = orpc.career.notifications.queryKey({ input: {} });

	// Hidden at once; the server hears about it when the toast closes.
	const markRead = (row: Notification) => {
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.notifications.key(),
			description: t`Marked as read`,
			errorMessage: t`Couldn't mark this as read. Try again.`,
			prepare: () => prepareRpc(client.career.markNotificationRead, { id: row.id }),
			hide: () => {
				onHide(row.id);
				queryClient.setQueryData(queryKey, (current) =>
					current?.map((item) => (item.id === row.id ? { ...item, readAt: new Date() } : item)),
				);
			},
			restore: () => onRestore(row.id),
		});
	};

	// Written here, not taken from the server's English title and body, so they follow the interface language.
	const title = (row: Notification) => {
		const notice = row.notice;
		if (notice.type === "opportunities")
			return plural(notice.count, { one: "# new role found", other: "# new roles found" });
		if (notice.type === "briefing") return t`Briefing ready for ${notice.company}`;
		if (notice.type === "followup") return t`Time to follow up with ${notice.company}`;
		return row.title;
	};
	const detail = (row: Notification) => {
		const notice = row.notice;
		if (notice.type === "opportunities") return t`for “${notice.query}”`;
		if (notice.type === "followup") return notice.note ? `“${notice.note}”` : null;
		if (notice.type === "briefing") return notice.role;
		return row.body || null;
	};
	const open = (row: Notification) => {
		if (row.notice.type === "opportunities")
			return document.getElementById("new-roles")?.scrollIntoView({ block: "start", behavior: "smooth" });
		if (row.url) router.history.push(row.url);
	};

	return (
		<section aria-labelledby="from-schedules">
			<SectionHeading
				id="from-schedules"
				className="pt-5"
				note={unread ? t`${i18n.number(unread)} new` : undefined}
				action={
					readCount > 0 && (
						<button type="button" className="hover:underline" onClick={() => onShowRead(!showRead)}>
							{showRead ? <Trans>Hide read</Trans> : <Trans>Show {i18n.number(readCount)} read</Trans>}
						</button>
					)
				}
			>
				<Trans>From your schedules</Trans>
			</SectionHeading>
			<List>
				<AnimatePresence initial={false}>
					{rows.map((row) => {
						const kind = resultKind(row.notice.type);
						// Only in-app paths: notifications link into the app, never elsewhere.
						const actionable = row.notice.type === "opportunities" || /^\/(?!\/)/.test(row.url ?? "");
						return (
							<CollapseRow key={row.id} className={COLLAPSE_ROW}>
								<ListRow
									leading={
										<IconTile className="bg-hover">
											<Icon name={kind.icon} size={20} />
										</IconTile>
									}
									title={title(row)}
									subtitle={[kind.source, stamp(row.createdAt, now), detail(row)].filter(Boolean).join(" · ")}
									variant={isUnread(row) ? "default" : "dim"}
									trailing={
										<span className="flex items-center gap-3.5">
											{actionable && (
												<Button size="sm" variant="secondary" onClick={() => open(row)}>
													{kind.action}
												</Button>
											)}
											{isUnread(row) && (
												<IconButton
													icon="check"
													label={t`Mark as read`}
													size="icon-sm"
													variant="ghost"
													className="text-ink-2"
													onClick={() => markRead(row)}
												/>
											)}
										</span>
									}
								/>
							</CollapseRow>
						);
					})}
				</AnimatePresence>
			</List>
		</section>
	);
}

// ---- New roles ----

/** "MF" for Marlow & Finch: letters only, two at most. */
const initialsOf = (name: string) => getInitials(name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim() || name).slice(0, 2);

const companyOf = (row: Opportunity) => row.company || new URL(row.url).hostname.replace(/^www\./, "");

type NewRolesProps = {
	now: Date;
	/** Every role, with a checkbox each: after the morning runs. Resting Today shows two. */
	selecting: boolean;
	/** No hero above: the selection's Track is the page's accent. */
	accent: boolean;
};

function NewRoles({ now, selecting: selectingByDefault, accent }: NewRolesProps) {
	const queryClient = useQueryClient();
	const { time } = useCareerTime();
	const distance = useDayDistance();
	const { data: rows, isError, refetch } = useQuery(orpc.career.opportunities.queryOptions({ input: {} }));
	const schedules = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const [hidden, setHidden] = useState<string[]>([]);
	const [expanded, setExpanded] = useState(false);
	const [open, setOpen] = useState<string | null>(null);
	const [selected, setSelected] = useState<string[]>([]);
	const [bulkPending, setBulkPending] = useState(false);
	const allId = useId();
	const selecting = selectingByDefault || expanded;
	const invalidateRoles = () => queryClient.invalidateQueries({ queryKey: orpc.career.opportunities.key() });

	const untrack = useMutation({
		...orpc.applications.delete.mutationOptions(),
		onSuccess: () => invalidateRoles(),
		onError: (error) =>
			toastError(error, t`Couldn't remove it from Applications. Try again.`, { allowServerMessage: true }),
	});
	// Callbacks live on the hook, not on mutate(), so each of several quick calls gets its own.
	const track = useMutation({
		...orpc.career.trackOpportunity.mutationOptions(),
		onSuccess: ({ applicationId }, { id }) => {
			const row = rows?.find((item) => item.id === id);
			toast.add({
				description: row ? t`Saved ${companyOf(row)} to Applications` : t`Saved to Applications`,
				actionProps: { children: t`Undo`, onClick: () => untrack.mutate({ id: applicationId }) },
			});
		},
		onError: (error) =>
			toastError(error, t`Couldn't save this role to Applications. Try again.`, { allowServerMessage: true }),
	});

	if (isError || schedules.isError)
		return (
			<section aria-labelledby="new-roles">
				<SectionHeading id="new-roles">
					<Trans>New roles</Trans>
				</SectionHeading>
				<CareerLoadError
					onRetry={() => {
						void refetch();
						void schedules.refetch();
					}}
				/>
			</section>
		);
	if (!rows || !schedules.data) return <Skeleton className="mt-8 h-40 rounded-xl" />;

	const visible = rows
		.filter((row) => !hidden.includes(row.id) && !row.trackedApplicationId)
		.sort((a, b) => new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime() || a.id.localeCompare(b.id));
	const shown = selecting ? visible : visible.slice(0, 2);
	const discovery = schedules.data.find((row) => row.kind === "discovery" && row.enabled);
	const today = visible.filter((row) => distance(row.firstSeenAt, now) === 0).length;
	const selection = selected.filter((id) => visible.some((row) => row.id === id));

	const onDismiss = (row: Opportunity) => {
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.opportunities.key(),
			description: t`Hidden from New roles`,
			errorMessage: t`Couldn't hide this role. Try again.`,
			prepare: () => prepareRpc(client.career.dismissOpportunity, { id: row.id }),
			hide: () => setHidden((current) => [...current, row.id]),
			restore: () => setHidden((current) => current.filter((id) => id !== row.id)),
		});
	};

	const bulk = async (kind: "track" | "dismiss") => {
		if (bulkPending || !selection.length) return;
		setBulkPending(true);
		const failed: string[] = [];
		// Each write takes the owner's mutex; send one at a time instead of flooding the server's queue.
		for (const id of selection) {
			try {
				if (kind === "track") await client.career.trackOpportunity({ id });
				else await client.career.dismissOpportunity({ id });
			} catch {
				failed.push(id);
			}
		}
		const done = selection.length - failed.length;
		setHidden((current) => [...new Set([...current, ...selection.filter((id) => !failed.includes(id))])]);
		setSelected(failed);
		if (failed.length)
			toast.add({
				type: "error",
				description: t`${i18n.number(done)} updated; ${i18n.number(failed.length)} failed. The failed roles stay selected.`,
			});
		else
			toast.add({
				description:
					kind === "track"
						? plural(done, { one: "# role saved to Applications", other: "# roles saved to Applications" })
						: plural(done, { one: "# role hidden", other: "# roles hidden" }),
			});
		await Promise.all([invalidateRoles(), queryClient.invalidateQueries({ queryKey: orpc.applications.key() })]);
		setBulkPending(false);
	};

	const clock = discovery ? time(discovery.nextRunAt) : "";
	const daily = discovery && (discovery.intervalDays ?? 1) === 1;
	// No zero count: without roles found today the note only says when discovery runs.
	const note =
		today === 0
			? daily && !selecting
				? t`Role discovery runs daily at ${clock}`
				: undefined
			: selecting
				? t`${i18n.number(today)} found today`
				: daily
					? t`${i18n.number(today)} today · role discovery runs daily at ${clock}`
					: t`${i18n.number(today)} today`;
	const all = visible.length > 0 && selection.length === visible.length;

	return (
		<section id="new-roles" aria-labelledby="new-roles-title" className="scroll-mt-6">
			<SectionHeading
				id="new-roles-title"
				className={selecting && selection.length ? "items-center" : undefined}
				note={visible.length ? note : undefined}
				action={
					selecting && selection.length > 0 ? (
						<span className="flex items-center gap-1.5 font-normal">
							<span className="me-1.5 text-[13px]/[18px] font-medium text-ink-2">
								{t`${i18n.number(selection.length)} selected`}
							</span>
							<Button size="sm" variant="ghost" disabled={bulkPending} onClick={() => void bulk("dismiss")}>
								<Trans>Not for me</Trans>
							</Button>
							<Button
								size="sm"
								variant={accent ? "primary" : "secondary"}
								loading={bulkPending}
								onClick={() => void bulk("track")}
							>
								<Icon name="bookmark-simple" />
								<Trans>Track {i18n.number(selection.length)}</Trans>
							</Button>
						</span>
					) : !selecting && visible.length > shown.length ? (
						<button type="button" className="hover:underline" onClick={() => setExpanded(true)}>
							<Trans>See all</Trans>
						</button>
					) : undefined
				}
			>
				<Trans>New roles</Trans>
			</SectionHeading>
			{visible.length === 0 ? (
				<EmptyState
					variant="compact"
					title={
						discovery ? (
							<Trans>No new roles. Role discovery runs again at {clock}.</Trans>
						) : (
							<Trans>Get new roles here every morning</Trans>
						)
					}
				/>
			) : (
				<>
					{selecting && (
						<div className="flex items-center gap-3.5 pb-1.5 text-[13px]/[18px] text-ink-3">
							<span className="flex items-center gap-2.5">
								<Checkbox
									id={allId}
									checked={all}
									indeterminate={selection.length > 0 && !all}
									disabled={bulkPending}
									onCheckedChange={() => setSelected(all ? [] : visible.map((row) => row.id))}
								/>
								<label htmlFor={allId}>
									<Trans>Select all roles</Trans>
								</label>
							</span>
							<span className="ms-auto">
								<Trans>Nothing is applied for or created until you choose.</Trans>
							</span>
						</div>
					)}
					<List>
						<AnimatePresence initial={false}>
							{shown.map((row) => (
								<CollapseRow key={row.id} className={COLLAPSE_ROW}>
									<RoleRow
										row={row}
										now={now}
										selecting={selecting}
										selected={selection.includes(row.id)}
										open={open === row.id}
										pending={(track.isPending && track.variables?.id === row.id) || bulkPending}
										onOpen={() => setOpen((current) => (current === row.id ? null : row.id))}
										onSelect={() =>
											setSelected((current) =>
												current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id],
											)
										}
										onTrack={() => track.mutate({ id: row.id })}
										onDismiss={() => onDismiss(row)}
									/>
								</CollapseRow>
							))}
						</AnimatePresence>
					</List>
				</>
			)}
		</section>
	);
}

type RoleRowProps = {
	row: Opportunity;
	now: Date;
	selecting: boolean;
	selected: boolean;
	open: boolean;
	pending: boolean;
	onOpen: () => void;
	onSelect: () => void;
	onTrack: () => void;
	onDismiss: () => void;
};

/** A role as one row; its detail (how it was found, what a match means) opens under it, one at a time. */
function RoleRow({ row, now, selecting, selected, open, pending, onOpen, onSelect, onTrack, onDismiss }: RoleRowProps) {
	const stamp = useStamp();
	const company = companyOf(row);
	const why = row.matches.length
		? t`matches ${row.matches.join(", ")}`
		: row.unknowns.includes("salary")
			? t`salary not listed`
			: row.unknowns.includes("office")
				? t`workplace not stated`
				: t`no preference phrase matches`;
	const host = new URL(row.url).hostname.replace(/^www\./, "");
	const detailId = `role-detail-${row.id}`;

	return (
		<>
			<ListRow
				interactive
				selected={selected}
				className={cn(selecting && "min-h-[52px]", open && "border-transparent")}
				leading={
					<>
						{selecting && (
							<Checkbox
								checked={selected}
								disabled={pending}
								onCheckedChange={onSelect}
								aria-label={t`Select ${row.role}`}
								className="relative z-10"
							/>
						)}
						<IconTile
							className={cn(
								"group-hover/row:bg-raised",
								selecting && "size-8 rounded-sm text-xs",
								selected && "bg-raised",
							)}
						>
							{initialsOf(company)}
						</IconTile>
					</>
				}
			>
				<span className="flex min-w-0 flex-1 flex-col gap-px">
					<button
						type="button"
						aria-expanded={open}
						aria-controls={detailId}
						onClick={onOpen}
						className={cn("truncate text-start t-row-title", rowLinkClassName)}
					>
						{row.role}
					</button>
					<span className="truncate text-[13px]/[18px] text-ink-3">
						{[company, row.location, why].filter(Boolean).join(" · ")}
					</span>
				</span>
				{!selecting && (
					<>
						<HoverActions>
							<Button size="sm" variant="ghost" disabled={pending} onClick={onDismiss}>
								<Trans>Not for me</Trans>
							</Button>
							<Button size="sm" variant="secondary" loading={pending} onClick={onTrack}>
								<Icon name="bookmark-simple" />
								<Trans>Track</Trans>
							</Button>
						</HoverActions>
						<RowCaret />
					</>
				)}
			</ListRow>
			{open && (
				<div
					id={detailId}
					className={cn(
						"flex flex-col gap-0.5 border-b border-line pt-0.5 pb-3 text-[13px]/[18px] text-ink-2",
						selecting ? "ps-[76px]" : "ps-[54px]",
					)}
				>
					<p>
						{row.discoverySource ? (
							<>
								{t`Found for “${row.discoverySource.query}” · posting checked ${stamp(row.discoverySource.checkedAt, now)}`}
								{" · "}
								<span className="t-mono">{host}</span>
							</>
						) : (
							<>
								{t`Earlier discovery result · last seen ${stamp(row.lastSeenAt, now)}`}
								{" · "}
								<span className="t-mono">{host}</span>
							</>
						)}
					</p>
					<p className="text-ink-3">
						<Trans>
							Matches are words your preferences share with the posting, not a checked salary, workplace or eligibility.
							Track it, then open Fit.
						</Trans>
					</p>
					<div className="-ms-2.5 flex flex-wrap items-center gap-1 pt-2">
						<Button
							size="sm"
							variant="ghost"
							nativeButton={false}
							render={<a href={row.url} target="_blank" rel="noopener noreferrer" />}
						>
							<Icon name="arrow-square-out" />
							<Trans>Read posting</Trans>
						</Button>
						<Button size="sm" variant="ghost" loading={pending} onClick={onTrack}>
							<Icon name="bookmark-simple" />
							<Trans>Track</Trans>
						</Button>
						<Button size="sm" variant="ghost" disabled={pending} onClick={onDismiss}>
							<Trans>Not for me</Trans>
						</Button>
					</div>
				</div>
			)}
		</>
	);
}

// ---- Pick up where you left off ----

type DocumentSummary = RouterOutput["documents"]["list"][number];

function PickUp({ documents }: { documents: DocumentSummary[] }) {
	if (documents.length === 0) return null;
	return (
		<section aria-labelledby="pick-up">
			<SectionHeading id="pick-up">
				<Trans>Pick up where you left off</Trans>
			</SectionHeading>
			<List>
				{documents.map((document) => {
					const edited = formatEdited(document.editedAt, i18n.locale);
					return (
						<ListRow
							key={`${document.type}:${document.id}`}
							leading={<DocumentThumb kind={document.type} />}
							title={document.name}
							subtitle={document.type === "resume" ? t`Resume · edited ${edited}` : t`Cover letter · edited ${edited}`}
							value={<DocumentStatusBadge document={document} />}
							caret
							render={
								document.type === "resume" ? (
									<Link to="/builder/$resumeId" params={{ resumeId: document.id }} />
								) : (
									<Link to="/builder/letter/$coverLetterId" params={{ coverLetterId: document.id }} />
								)
							}
						/>
					);
				})}
			</List>
		</section>
	);
}

// ---- Coming up ----

function ComingUp({ now }: { now: Date }) {
	const { format, plainTime, timeZone } = useCareerTime();
	const applications = useQuery(applicationsListQueryOptions());
	const offers = useQuery(savedOffersQueryOptions());
	const events = upcomingApplicationEvents(
		applications.data ?? [],
		offers.data ? latestOfferHints(offers.data) : undefined,
		now,
		timeZone,
	)
		// Follow-ups that are due already sit in Needs you; the agenda holds calls, interviews and offer deadlines.
		.filter((event) => event.kind !== "follow-up")
		.slice(0, 4);

	return (
		<section aria-labelledby="coming-up">
			<SectionHeading
				id="coming-up"
				action={
					events.length > 0 && (
						<Link to="/dashboard/applications" search={{ view: "calendar" }} className="inline-block hover:underline">
							<Trans>Calendar</Trans>
						</Link>
					)
				}
			>
				<Trans>Coming up</Trans>
			</SectionHeading>
			{events.length === 0 ? (
				<p className="max-w-[36ch] pt-1 text-[13px]/[18px] text-ink-3">
					<Trans>Interviews, follow-ups and offer deadlines appear here once you save a job.</Trans>
				</p>
			) : (
				<List>
					{events.map((event) => {
						const clock = plainTime(event.at);
						const subtitle =
							event.kind === "interview"
								? `${interviewStepTitle(event.interview.kind)} · ${clock}`
								: clock === "23:59"
									? t`Offer deadline · end of day`
									: t`Offer deadline · ${clock}`;
						return (
							<ListRow
								key={event.key}
								// calm: request to lead — DateColumn draws the day over the label; the boards put the weekday on top.
								leading={
									<DateColumn
										day={format(event.at, { day: "numeric" })}
										label={format(event.at, { weekday: "short" })}
									/>
								}
								title={event.application.company}
								subtitle={subtitle}
								render={
									event.kind === "offer" ? (
										<Link to="/dashboard/career/offers" />
									) : (
										<Link
											to="/dashboard/applications/$applicationId/{-$tab}"
											params={{ applicationId: event.application.id, tab: "prepare" }}
											search={{ round: event.interview.id }}
										/>
									)
								}
							/>
						);
					})}
				</List>
			)}
		</section>
	);
}

// ---- Schedules, beside the results ----

type SchedulesPanelProps = { deleted: string[]; onOpenSchedule: (schedule: string) => void };

const KIND_ORDER = ["discovery", "prepare", "follow-up"];

function SchedulesPanel({ deleted, onOpenSchedule }: SchedulesPanelProps) {
	const queryClient = useQueryClient();
	const { day, time, when } = useCareerTime();
	const queryKey = orpc.career.schedules.queryKey({ input: {} });
	const { data: schedules, isError, refetch } = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const save = useMutation({
		...orpc.career.saveSchedule.mutationOptions(),
		onMutate: (input) => {
			const previous = queryClient.getQueryData(queryKey)?.find((item) => item.id === input.id);
			queryClient.setQueryData(queryKey, (current) =>
				current?.map((item) =>
					item.id === input.id
						? {
								...item,
								enabled: input.enabled ?? item.enabled,
								nextRunAt: input.nextRunAt instanceof Date ? input.nextRunAt : item.nextRunAt,
							}
						: item,
				),
			);
			return { previous };
		},
		onSuccess: (saved, input) => {
			const { title } = scheduleKind(input.kind);
			toast.add({
				description: input.enabled ? t`${title} is on · next ${when(saved.nextRunAt)}` : t`${title} paused`,
			});
		},
		onError: (error, _input, context) => {
			const previous = context?.previous;
			if (previous)
				queryClient.setQueryData(queryKey, (current) =>
					current?.map((item) => (item.id === previous.id ? previous : item)),
				);
			toastError(error, t`Couldn't change this schedule. Try again.`, { allowServerMessage: true });
		},
	});
	// A stable order (kind, then newest): an update must not reshuffle rows that share a creation time.
	const rows = schedules
		?.filter((row) => !deleted.includes(row.id))
		.sort(
			(a, b) =>
				KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
				a.id.localeCompare(b.id),
		);

	const status = (row: Schedule) => {
		// A one-off's queued run goes by its outcome: still running or retrying, failed after its last try, or done.
		if (!row.intervalDays && row.lastQueuedAt) {
			const run = row.lastRun?.status;
			if (run === "failed") return t`Failed · ${day(row.nextRunAt)} · open to check it`;
			if (run === "queued" || run === "running") return t`Running · ${day(row.nextRunAt)}`;
			if (row.kind === "prepare") return t`Ran ${day(row.nextRunAt)} · done for this interview`;
			return t`Done · ${day(row.nextRunAt)}`;
		}
		if (row.lastRun?.status === "failed") return t`Last run failed · open to check it`;
		let line = when(row.nextRunAt);
		if (row.kind === "discovery") {
			const clock = time(row.nextRunAt);
			const next = day(row.nextRunAt);
			const days = row.intervalDays ?? 1;
			line =
				days === 1
					? t`Daily at ${clock} · next ${next}`
					: days === 7
						? t`Weekly at ${clock} · next ${next}`
						: t`Every ${ph({ days: i18n.number(days) })} days at ${clock} · next ${next}`;
		} else if (row.kind === "prepare") {
			const lead = row.lead === "2h" ? t`2 hours before` : row.lead === "morning" ? t`Morning of` : t`24 hours before`;
			line = `${lead} · ${line}`;
		}
		return row.enabled ? line : t`Paused · ${line}`;
	};

	const toggle = (row: Schedule, enabled: boolean) => {
		// Turning a repeating schedule back on starts from its next future run, at the same time of day.
		const nextRunAt =
			enabled && row.intervalDays
				? rollForward(new Date(row.nextRunAt), row.intervalDays, row.timezone)
				: new Date(row.nextRunAt);
		save.mutate({
			id: row.id,
			kind: row.kind as Kind,
			applicationId: row.applicationId,
			query: row.query,
			interviewId: row.interviewId,
			lead: row.lead as Lead | null,
			enabled,
			email: row.email,
			nextRunAt,
			timezone: row.timezone,
			intervalDays: row.intervalDays,
			aiProviderId: row.aiProviderId,
		});
	};

	return (
		<section aria-labelledby="schedules">
			<SectionHeading
				id="schedules"
				action={
					<Link to="/dashboard/career/schedules" className="inline-block hover:underline">
						<Trans>Manage</Trans>
					</Link>
				}
			>
				<Trans>Schedules</Trans>
			</SectionHeading>
			{isError ? (
				<CareerLoadError onRetry={() => void refetch()} />
			) : !rows ? (
				<Skeleton className="h-24" />
			) : rows.length === 0 ? (
				<EmptyState variant="compact" title={<Trans>Nothing scheduled yet.</Trans>} />
			) : (
				<List>
					{rows.map((row) => {
						const { title } = scheduleKind(row.kind);
						// A finished one-off has nothing left to run: it opens to pick a new time.
						const finished = !row.intervalDays && Boolean(row.lastQueuedAt);
						return (
							<ListRow
								key={row.id}
								interactive
								trailing={
									!finished && (
										<Switch
											aria-label={row.enabled ? t`${title} is on` : t`${title} is off`}
											checked={row.enabled}
											onCheckedChange={(enabled) => toggle(row, enabled)}
										/>
									)
								}
							>
								<button
									type="button"
									onClick={() => onOpenSchedule(row.id)}
									className={cn("flex min-w-0 flex-1 flex-col gap-px text-start", rowLinkClassName)}
								>
									<span className="truncate text-sm/[22px] font-medium">{title}</span>
									<span
										className={cn(
											"truncate text-[13px]/[18px]",
											row.lastRun?.status === "failed" ? "text-danger-text" : "text-ink-3",
										)}
									>
										{status(row)}
									</span>
								</button>
							</ListRow>
						);
					})}
				</List>
			)}
		</section>
	);
}

// ---- First run ----

/** A new account: import leads, Start blank is its peer, the sample a quiet third; then where to go next. */
function FirstRun() {
	const { startBlank, trySample, creating } = useStartDocument();
	const next: { icon: IconName; title: ReactNode; subtitle: ReactNode; link: ReactElement }[] = [
		{
			icon: "briefcase",
			title: <Trans>Save a job</Trans>,
			subtitle: (
				<Trans>Paste a job link. The posting is kept, so Check, the assistant and your letter can use it.</Trans>
			),
			link: <Link to="/dashboard/applications" search={{ create: true }} />,
		},
		{
			icon: "target",
			title: <Trans>Set your preferences</Trans>,
			subtitle: <Trans>Roles, places and what matters to you. New roles are matched against them.</Trans>,
			link: <Link to="/dashboard/career/knowledge/preferences" />,
		},
		{
			icon: "books",
			title: <Trans>Add facts about your work</Trans>,
			subtitle: <Trans>What you've done, with numbers when you have them. The coach draws on them.</Trans>,
			link: <Link to="/dashboard/career/knowledge/facts" />,
		},
		{
			icon: "compass",
			title: <Trans>Ask the coach</Trans>,
			subtitle: <Trans>Bring a question about your search. Needs an AI connection.</Trans>,
			link: <Link to="/dashboard/career/coach/{-$conversationId}" params={{ conversationId: undefined }} />,
		},
	];

	return (
		<>
			<DropToImport />
			<HeroCard
				className="mt-5"
				title={<Trans>Start with your resume</Trans>}
				actions={
					<>
						<Button size="lg" className={LG} nativeButton={false} render={<Link to="/dashboard/documents/import" />}>
							<Icon name="file-arrow-up" />
							<Trans>Choose a file</Trans>
						</Button>
						<Button size="lg" variant="secondary" className={LG} disabled={creating} onClick={() => void startBlank()}>
							<Trans>Start blank</Trans>
						</Button>
						<Button size="lg" variant="ghost" className={LG} disabled={creating} onClick={() => void trySample()}>
							<Trans>Try a sample</Trans>
						</Button>
					</>
				}
			>
				<span className="block pointer-coarse:hidden">
					<Trans>
						Import the one you have and every section is laid out for you to refine, or start from a blank page. You can
						also drop a PDF, Word or JSON file anywhere in this window.
					</Trans>
				</span>
				<span className="hidden pointer-coarse:block">
					<Trans>
						Import the one you have and every section is laid out for you to refine, or start from a blank page.
					</Trans>
				</span>
			</HeroCard>
			<Columns
				aside={
					<section aria-labelledby="coming-up">
						<SectionHeading id="coming-up">
							<Trans>Coming up</Trans>
						</SectionHeading>
						<p className="max-w-[36ch] pt-1 text-[13px]/[18px] text-ink-3">
							<Trans>Interviews, follow-ups and offer deadlines appear here once you save a job.</Trans>
						</p>
					</section>
				}
			>
				<section aria-labelledby="when-ready">
					<SectionHeading id="when-ready">
						<Trans>When you're ready</Trans>
					</SectionHeading>
					<List>
						{next.map((item) => (
							<ListRow
								key={item.icon}
								leading={
									<IconTile>
										<Icon name={item.icon} size={20} />
									</IconTile>
								}
								title={item.title}
								subtitle={item.subtitle}
								caret
								render={item.link}
							/>
						))}
					</List>
				</section>
			</Columns>
		</>
	);
}
