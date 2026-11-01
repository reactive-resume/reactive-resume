import type { Kind, Lead, Schedule } from "./schedule-sheet";
import type { RouterOutput } from "@/libs/orpc/client";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Ref } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { CareerLoadError } from "./load-state";
import { rollForward, ScheduleSheet, scheduleKind } from "./schedule-sheet";
import { CollapseRow, Eyebrow, flash, InfoChip, Swap, useCareerTime, useNow, withUndo } from "./shared";
import {
	collectInterviews,
	formatDuration,
	interviewKindOf,
	upcomingInterviews,
} from "@/features/applications/interviews";
import {
	compareNextStepSortKeys,
	describeNextStep,
	getNextStep,
	needsAttention,
	nextStepSortKey,
} from "@/features/applications/next-step";
import { offerHintFor, useOfferHints } from "@/features/applications/queries";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useSaveTimezone } from "@/features/settings/use-save-timezone";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Notification = RouterOutput["career"]["notifications"][number];
type Opportunity = RouterOutput["career"]["opportunities"][number];

type TodayPageProps = { schedule: string | undefined; onScheduleChange: (schedule: string | undefined) => void };

/**
 * Career → Today: what needs you, roles found by discovery, the next interview and the schedules that produce them.
 * Below 1024px it's one column: Coming up, Needs you, New roles, Schedules.
 */
export function TodayPage({ schedule, onScheduleChange }: TodayPageProps) {
	const now = useNow();
	const rolesRef = useRef<HTMLElement>(null);
	// Deleted schedules stay hidden locally until the Undo toast closes; any mutation refetches every query.
	const [deleted, setDeleted] = useState<string[]>([]);
	const remove = useMutation({
		...orpc.career.deleteSchedule.mutationOptions(),
		onError: (error, { id }) => {
			setDeleted((current) => current.filter((item) => item !== id));
			toastError(error, t`Couldn't delete this schedule. Try again.`, { allowServerMessage: true });
		},
	});
	const deleteSchedule = (id: string) => {
		setDeleted((current) => [...current, id]);
		withUndo({
			description: t`Schedule deleted`,
			commit: () => remove.mutate({ id }),
			onUndo: () => setDeleted((current) => current.filter((item) => item !== id)),
		});
	};

	const reviewRoles = () => {
		const section = rolesRef.current;
		if (!section) return;
		for (const card of section.querySelectorAll("[data-role-card]")) flash(card);
		// Last, so the section heading wins over each card's own scroll.
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		section.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
	};

	return (
		<div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px]">
			<TimezoneNotice className="order-first lg:col-span-full" />
			<div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-7">
				<NeedsYou now={now} onReview={reviewRoles} className="order-2 lg:order-none" />
				<NewRoles
					ref={rolesRef}
					now={now}
					deleted={deleted}
					onOpenSchedule={onScheduleChange}
					className="order-3 scroll-mt-6 lg:order-none"
				/>
			</div>
			<div className="contents lg:flex lg:flex-col lg:gap-[18px]">
				<ComingUp now={now} className="order-1 lg:order-none" />
				<Schedules deleted={deleted} onOpenSchedule={onScheduleChange} className="order-4 lg:order-none" />
			</div>
			<ScheduleSheet schedule={schedule} onScheduleChange={onScheduleChange} onDelete={deleteSchedule} />
		</div>
	);
}

/**
 * When the account's timezone isn't this device's, times here carry their zone ("16:56 UTC"); this says so once and
 * offers the device's zone in one step, as Settings → Preferences does.
 */
function TimezoneNotice({ className }: { className?: string }) {
	const { timeZone, deviceTimeZone } = useCareerTime();
	const save = useSaveTimezone();
	const [saving, setSaving] = useState(false);
	if (!deviceTimeZone) return null;
	return (
		<p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2", className)}>
			<Icon name="globe-simple" size={18} className="text-ink-3" />
			<Trans>Times here are in {timeZone}, your account's timezone.</Trans>
			<Button
				variant="link"
				className="h-auto p-0 text-[13px] text-ink-2 underline"
				disabled={saving}
				onClick={() => {
					setSaving(true);
					void save(deviceTimeZone).finally(() => setSaving(false));
				}}
			>
				<Trans>Use this device's timezone ({deviceTimeZone})</Trans>
			</Button>
		</p>
	);
}

// ---- Shared bits ----

/** 0 for today, -1 for yesterday, 1 for tomorrow (in the Preferences timezone), otherwise null. */
function useDayOffset() {
	const { format } = useCareerTime();
	return (value: Date | string, now: Date) => {
		const key = (date: Date | string) => format(date, { dateStyle: "short" });
		const day = key(value);
		for (const offset of [0, -1, 1]) if (key(new Date(now.getTime() + offset * 86_400_000)) === day) return offset;
		return null;
	};
}

type SectionHeadingProps = { id: string; title: string; count: number | undefined; note?: string };

/** "Needs you 3": 17/600 with a mono count, and an optional note on the right. */
function SectionHeading({ id, title, count, note }: SectionHeadingProps) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
			<h2 id={id} className="text-[17px] font-semibold">
				{title}
			</h2>
			{count !== undefined && <span className="font-mono text-xs font-medium text-ink-3">{count}</span>}
			{note && <span className="ms-auto text-xs text-ink-3">{note}</span>}
		</div>
	);
}

// ---- Needs you ----

const notificationKind = (kind: Notification["notice"]["type"]): { icon: IconName; tone: string; action: string } => {
	if (kind === "opportunities") return { icon: "globe-simple", tone: "bg-info-soft text-info-text", action: t`Review` };
	if (kind === "followup") return { icon: "envelope", tone: "bg-warn-soft text-warn-text", action: t`Review draft` };
	if (kind === "briefing")
		return { icon: "clipboard-text", tone: "bg-accent-soft text-accent-text", action: t`Open briefing` };
	return { icon: "info", tone: "bg-warn-soft text-warn-text", action: t`Open` };
};

type NeedsYouProps = { now: Date; onReview: () => void; className?: string };

function NeedsYou({ now, onReview, className }: NeedsYouProps) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const { time, when, locale, timeZone } = useCareerTime();
	const dayOffset = useDayOffset();
	const queryKey = orpc.career.notifications.queryKey({ input: {} });
	const { data, isError, refetch } = useQuery(orpc.career.notifications.queryOptions({ input: {} }));
	const applicationQuery = useQuery(applicationsListQueryOptions());
	const applications = applicationQuery.data;
	const hints = useOfferHints();
	const [showRead, setShowRead] = useState(false);
	const [pending, setPending] = useState<string[]>([]);
	const setReadAt = (id: string, readAt: Date | null) =>
		queryClient.setQueryData(queryKey, (current) => current?.map((row) => (row.id === id ? { ...row, readAt } : row)));
	const markRead = useMutation({
		...orpc.career.markNotificationRead.mutationOptions(),
		onError: (error, { id }) => {
			setPending((current) => current.filter((item) => item !== id));
			setReadAt(id, null);
			toastError(error, t`Couldn't mark this as read. Try again.`, { allowServerMessage: true });
		},
	});

	const isUnread = (row: Notification) => !row.readAt && !pending.includes(row.id);
	const unread = data?.filter(isUnread) ?? [];
	const read = data?.filter((row) => !isUnread(row)) ?? [];
	const rows = showRead ? (data ?? []) : unread;
	// The same next-step rules as the Applications list: due follow-ups, no reply, interviews this week, offers.
	const attention = (applications ?? [])
		.flatMap((application) => {
			const step = getNextStep(application, now, timeZone, offerHintFor(hints, application.id));
			return needsAttention(step, now)
				? [{ application, step, key: nextStepSortKey(application, now, timeZone, offerHintFor(hints, application.id)) }]
				: [];
		})
		.sort((a, b) => compareNextStepSortKeys(a.key, b.key, a.application.id, b.application.id));

	// Hidden at once; the server hears about it when the toast closes. The cache edit drops the sidebar count too,
	// while `pending` keeps the row hidden through any refetch.
	const dismiss = (row: Notification) => {
		setPending((current) => [...current, row.id]);
		setReadAt(row.id, new Date());
		withUndo({
			description: t`Marked as read`,
			commit: () => markRead.mutate({ id: row.id }),
			onUndo: () => {
				setPending((current) => current.filter((id) => id !== row.id));
				setReadAt(row.id, null);
			},
		});
	};

	// One lookup table and one formatter per render, not a scan and a constructor per row.
	const companies = new Map(applications?.map((application) => [application.id, application.company]));
	const relativeDay = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const meta = (row: Notification) => {
		const source =
			row.notice.type === "opportunities"
				? t`Opportunity discovery`
				: row.notice.type === "briefing"
					? t`Interview preparation`
					: row.applicationId
						? companies.get(row.applicationId)
						: undefined;
		const offset = dayOffset(row.createdAt, now);
		const stamp =
			offset === null ? when(row.createdAt) : `${relativeDay.format(offset, "day")}, ${time(row.createdAt)}`;
		return [source, stamp].filter(Boolean).join(" · ");
	};

	const act = (row: Notification) => {
		if (row.notice.type === "opportunities") onReview();
		else if (row.url) router.history.push(row.url);
	};

	return (
		<section aria-labelledby="needs-you" className={cn("flex flex-col gap-2.5", className)}>
			<SectionHeading
				id="needs-you"
				title={t`Needs you`}
				count={data && applications ? unread.length + attention.length : undefined}
			/>
			{isError || applicationQuery.isError ? (
				<CareerLoadError
					onRetry={() => {
						void refetch();
						void applicationQuery.refetch();
					}}
				/>
			) : !data || !applications ? (
				<Skeleton className="h-40 rounded-xl" />
			) : (
				<Swap id={rows.length + attention.length > 0 ? "list" : "empty"}>
					{rows.length + attention.length > 0 ? (
						<div role="list" className="overflow-hidden rounded-xl border border-line bg-surface">
							<AnimatePresence initial={false}>
								{rows.map((row) => {
									const kind = notificationKind(row.notice.type);
									// Only in-app paths: notifications link into the app, never elsewhere.
									const actionable = row.notice.type === "opportunities" || /^\/(?!\/)/.test(row.url ?? "");
									return (
										<CollapseRow key={row.id} role="listitem" className="border-t border-line first:border-t-0">
											<div
												role="group"
												aria-labelledby={`note-${row.id}`}
												// Off-screen rows skip layout and paint; they stay findable and readable.
												className="flex items-start gap-3.5 px-4 py-3.5 [contain-intrinsic-size:auto_96px] [content-visibility:auto]"
											>
												<span
													aria-hidden="true"
													className={cn("grid size-[34px] shrink-0 place-items-center rounded-lg", kind.tone)}
												>
													<Icon name={kind.icon} size={20} />
												</span>
												<div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
													<div className="grid min-w-0 flex-1 basis-56 gap-0.5">
														<p id={`note-${row.id}`} className="text-sm leading-5 font-semibold">
															{row.title}
														</p>
														<p className="text-[13px] leading-[19px] text-ink-2">{row.body}</p>
														<p className="mt-0.5 text-xs text-ink-3">{meta(row)}</p>
													</div>
													{actionable && (
														<Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => act(row)}>
															{kind.action}
														</Button>
													)}
												</div>
												{isUnread(row) && (
													<IconButton
														icon="check"
														label={t`Mark as read`}
														size="icon-sm"
														iconSize={20}
														className="text-ink-2"
														onClick={() => dismiss(row)}
													/>
												)}
											</div>
										</CollapseRow>
									);
								})}
								{attention.map(({ application, step }) => {
									const text = describeNextStep(step, application, locale, timeZone);
									return (
										<CollapseRow
											key={`application-${application.id}`}
											role="listitem"
											className="border-t border-line first:border-t-0"
										>
											<div
												role="group"
												aria-labelledby={`attention-${application.id}`}
												className="flex items-start gap-3.5 px-4 py-3.5 [contain-intrinsic-size:auto_96px] [content-visibility:auto]"
											>
												<span
													aria-hidden="true"
													className={cn(
														"grid size-[34px] shrink-0 place-items-center rounded-lg",
														text.tone === "warn" ? "bg-warn-soft text-warn-text" : "bg-accent-soft text-accent-text",
													)}
												>
													<Icon name={text.icon} size={20} />
												</span>
												<div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
													<div className="grid min-w-0 flex-1 basis-56 gap-0.5">
														<p id={`attention-${application.id}`} className="text-sm leading-5 font-semibold">
															{text.title}
														</p>
														{text.sub && <p className="text-[13px] leading-[19px] text-ink-2">{text.sub}</p>}
														<p className="mt-0.5 text-xs text-ink-3">
															{application.company} · {application.role}
														</p>
													</div>
													<Button
														variant="secondary"
														nativeButton={false}
														className="h-8 px-3 text-[13px]"
														render={
															<Link
																to="/dashboard/applications/$applicationId/{-$tab}"
																params={{
																	applicationId: application.id,
																	tab: step.kind === "interview" ? "prepare" : "messages",
																}}
															/>
														}
													>
														<Trans>Open workspace</Trans>
													</Button>
												</div>
											</div>
										</CollapseRow>
									);
								})}
							</AnimatePresence>
						</div>
					) : (
						<EmptyState
							title={<Trans>You're up to date</Trans>}
							description={<Trans>New roles, reminders and finished briefings appear here.</Trans>}
							secondary={
								read.length > 0 ? (
									<Button
										variant="ghost"
										size="sm"
										className="text-ink-2 underline underline-offset-3"
										onClick={() => setShowRead(true)}
									>
										<Trans>Show {read.length} read</Trans>
									</Button>
								) : undefined
							}
						/>
					)}
				</Swap>
			)}
		</section>
	);
}

// ---- New roles ----

type Tracked = Record<string, { applicationId: string; undoable: boolean }>;

type NewRolesProps = {
	ref: Ref<HTMLElement>;
	now: Date;
	deleted: string[];
	onOpenSchedule: (schedule: string) => void;
	className?: string;
};

function NewRoles({ ref, now, deleted, onOpenSchedule, className }: NewRolesProps) {
	const queryClient = useQueryClient();
	const { time, day } = useCareerTime();
	const dayOffset = useDayOffset();
	const { data: rows, isError, refetch } = useQuery(orpc.career.opportunities.queryOptions({ input: {} }));
	const scheduleQuery = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const schedules = scheduleQuery.data;
	const [hidden, setHidden] = useState<string[]>([]);
	const [tracked, setTracked] = useState<Tracked>({});
	const [expanded, setExpanded] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [bulkPending, setBulkPending] = useState(false);
	const [bulkStatus, setBulkStatus] = useState("");
	const invalidateRoles = () => queryClient.invalidateQueries({ queryKey: orpc.career.opportunities.key() });
	// Callbacks live on the hooks, not on mutate(), so each of several quick calls gets its own.
	const track = useMutation({
		...orpc.career.trackOpportunity.mutationOptions(),
		onSuccess: ({ applicationId }, { id }) => {
			setTracked((current) => ({ ...current, [id]: { applicationId, undoable: true } }));
			window.setTimeout(
				() =>
					setTracked((current) => {
						const entry = current[id];
						return entry ? { ...current, [id]: { ...entry, undoable: false } } : current;
					}),
				10_000,
			);
			// Every mutation refetches all queries (MutationCache), so the sidebar's Applications count updates.
			const row = rows?.find((item) => item.id === id);
			toast.add({ description: row ? t`Saved ${companyOf(row)} to Applications` : t`Saved to Applications` });
		},
		onError: (error) =>
			toastError(error, t`Couldn't save this role to Applications. Try again.`, { allowServerMessage: true }),
	});
	const untrack = useMutation({
		...orpc.applications.delete.mutationOptions(),
		onSuccess: async (_data, { id: applicationId }) => {
			// The role is back once the list knows it's untracked; dropping it from `tracked` first would flicker.
			await invalidateRoles();
			setTracked((current) =>
				Object.fromEntries(Object.entries(current).filter(([, entry]) => entry.applicationId !== applicationId)),
			);
		},
		onError: (error) =>
			toastError(error, t`Couldn't remove it from Applications. Try again.`, { allowServerMessage: true }),
	});
	const dismiss = useMutation({
		...orpc.career.dismissOpportunity.mutationOptions(),
		onError: (error, { id }) => {
			setHidden((current) => current.filter((item) => item !== id));
			toastError(error, t`Couldn't hide this role. Try again.`, { allowServerMessage: true });
		},
	});

	const visible = (rows ?? [])
		.filter((row) => !hidden.includes(row.id) && (!row.trackedApplicationId || tracked[row.id]))
		.sort(
			(a, b) =>
				b.matches.length - a.matches.length || new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime(),
		);
	const shown = expanded ? visible : visible.slice(0, 5);
	const discovery =
		schedules?.filter((schedule) => schedule.kind === "discovery" && !deleted.includes(schedule.id)) ?? [];
	const active = discovery.find((schedule) => schedule.enabled) ?? discovery[0];

	const selectable = visible.filter((row) => !row.trackedApplicationId && !tracked[row.id]);
	const selection = selected.filter((id) => selectable.some((row) => row.id === id));
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
		const done = selection.filter((id) => !failed.includes(id));
		setHidden((current) => [...new Set([...current, ...done])]);
		setSelected(failed);
		setBulkStatus(
			failed.length
				? t`${done.length} updated; ${failed.length} failed. Failed roles remain selected. Refresh or retry.`
				: plural(done.length, { one: "# role updated.", other: "# roles updated." }),
		);
		await Promise.all([invalidateRoles(), queryClient.invalidateQueries({ queryKey: orpc.applications.key() })]);
		setBulkPending(false);
	};

	const onTrack = (row: Opportunity) => track.mutate({ id: row.id });
	const onUndoTrack = (applicationId: string) => untrack.mutate({ id: applicationId });

	const onDismiss = (row: Opportunity) => {
		setHidden((current) => [...current, row.id]);
		withUndo({
			description: t`Hidden from New roles`,
			commit: () => dismiss.mutate({ id: row.id }),
			onUndo: () => setHidden((current) => current.filter((id) => id !== row.id)),
		});
	};

	const emptyLine = () => {
		if (!active) return null;
		if (!active.enabled)
			return (
				<p className="flex flex-wrap items-center gap-x-1 px-0.5 py-1.5 text-[13px] text-ink-3">
					<Trans>No new roles. Discovery is paused.</Trans>
					<Button
						variant="link"
						className="text-[13px] text-ink-2 underline underline-offset-3"
						onClick={() => onOpenSchedule(active.id)}
					>
						<Trans>Open the schedule</Trans>
					</Button>
				</p>
			);
		const offset = dayOffset(active.nextRunAt, now);
		const clock = time(active.nextRunAt);
		return (
			<p className="px-0.5 py-1.5 text-[13px] text-ink-3">
				{offset === 0
					? t`No new roles. Discovery runs again today at ${clock}.`
					: offset === 1
						? t`No new roles. Discovery runs again tomorrow at ${clock}.`
						: t`No new roles. Discovery runs again on ${day(active.nextRunAt)} at ${clock}.`}
			</p>
		);
	};

	return (
		<section ref={ref} aria-labelledby="new-roles" className={cn("flex flex-col gap-2.5", className)}>
			<SectionHeading
				id="new-roles"
				title={t`New roles from your search`}
				count={rows ? visible.filter((row) => !tracked[row.id]).length : undefined}
				note={t`Nothing is applied for or created until you choose.`}
			/>
			{isError || scheduleQuery.isError ? (
				<CareerLoadError
					onRetry={() => {
						void refetch();
						void scheduleQuery.refetch();
					}}
				/>
			) : !rows || !schedules ? (
				<Skeleton className="h-52 rounded-xl" />
			) : visible.length === 0 ? (
				active ? (
					emptyLine()
				) : (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-2 px-4 py-3.5">
						<p className="text-sm text-ink-2">
							<Trans>Get new roles here every morning</Trans>
						</p>
						<Button
							variant="secondary"
							className="h-8 px-3 text-[13px]"
							onClick={() => onOpenSchedule("new:discovery")}
						>
							<Icon name="globe-simple" size={18} />
							<Trans>Set up discovery</Trans>
						</Button>
					</div>
				)
			) : (
				<div>
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<Button
							variant="ghost"
							disabled={bulkPending || track.isPending}
							onClick={() => setSelected(selection.length === selectable.length ? [] : selectable.map((row) => row.id))}
						>
							<Trans>Select all roles</Trans>
						</Button>
						<span className="text-xs">{t`${selection.length} selected`}</span>
						<Button
							variant="secondary"
							disabled={!selection.length || bulkPending || track.isPending}
							onClick={() => void bulk("track")}
						>
							<Trans>Track selected</Trans>
						</Button>
						<Button
							variant="ghost"
							disabled={!selection.length || bulkPending || track.isPending}
							onClick={() => void bulk("dismiss")}
						>
							<Trans>Dismiss selected</Trans>
						</Button>
					</div>
					<AnimatePresence initial={false}>
						{shown.map((row) => {
							const offset = dayOffset(row.firstSeenAt, now);
							return (
								<CollapseRow key={row.id} className="pb-3">
									<RoleCard
										row={row}
										found={
											offset === 0
												? t`Found today`
												: offset === -1
													? t`Found yesterday`
													: t`Found ${day(row.firstSeenAt)}`
										}
										tracked={tracked[row.id]}
										pending={(track.isPending && track.variables?.id === row.id) || bulkPending}
										selected={selection.includes(row.id)}
										onSelect={() =>
											setSelected((current) =>
												current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id],
											)
										}
										onTrack={onTrack}
										onUndo={onUndoTrack}
										onDismiss={onDismiss}
									/>
								</CollapseRow>
							);
						})}
					</AnimatePresence>
					{visible.length > shown.length && (
						<Button variant="ghost" size="sm" className="text-ink-2" onClick={() => setExpanded(true)}>
							<Trans>Show {visible.length - shown.length} more</Trans>
						</Button>
					)}
				</div>
			)}
			{bulkStatus && (
				<p role="status" className="text-sm">
					{bulkStatus}
				</p>
			)}
		</section>
	);
}

type RoleCardProps = {
	row: Opportunity;
	selected: boolean;
	onSelect: () => void;
	found: string;
	tracked: Tracked[string] | undefined;
	pending: boolean;
	onTrack: (row: Opportunity) => void;
	onUndo: (applicationId: string) => void;
	onDismiss: (row: Opportunity) => void;
};

const companyOf = (row: Opportunity) => row.company || new URL(row.url).hostname.replace(/^www\./, "");

function RoleCard({ row, found, tracked, pending, selected, onSelect, onTrack, onUndo, onDismiss }: RoleCardProps) {
	const { matches, unknowns } = row;
	const { when } = useCareerTime();
	const company = companyOf(row);
	const unknownLabels = { salary: t`Salary not detected`, office: t`Workplace arrangement unknown` };
	return (
		<article
			data-role-card
			aria-labelledby={`role-${row.id}`}
			className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
		>
			{!tracked && (
				<label className="flex items-center gap-2 text-xs">
					<input type="checkbox" checked={selected} disabled={pending} onChange={onSelect} />
					{t`Select ${row.role}`}
				</label>
			)}
			<div className="flex items-start gap-3">
				<span
					aria-hidden="true"
					className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-sm font-semibold text-ink-2"
				>
					{getInitials(company).slice(0, 1)}
				</span>
				<div className="grid min-w-0 gap-0.5">
					<h3 id={`role-${row.id}`} className="text-[15px] font-semibold">
						{row.role}
					</h3>
					<p className="text-[13px] text-ink-3">{[company, row.location, found].filter(Boolean).join(" · ")}</p>
				</div>
			</div>
			{row.snippet && <p className="text-sm leading-[21px] text-ink-2">{row.snippet}</p>}
			<p className="text-xs text-ink-3">
				{t`Source: ${new URL(row.url).hostname}`} · {t`Last seen in search: ${when(row.lastSeenAt)}`}
			</p>
			<p className="text-xs text-ink-3">
				{row.discoverySource
					? t`Found for “${row.discoverySource.query}”. Posting checked ${when(row.discoverySource.checkedAt)}.`
					: t`Earlier discovery result. Search query and posting check time unknown.`}
			</p>
			<p className="text-xs text-ink-3">
				<Trans>Postings can change or close. Publication date unknown; search coverage is incomplete.</Trans>
			</p>
			<p className="text-xs text-ink-2">
				{matches.length
					? t`Preference phrase matches: ${matches.join(" · ")}`
					: t`No current target-role or location phrase matches.`}
			</p>
			<p className="text-xs text-ink-3">{t`Keyword overlap: ${(row.keywordOverlap ?? []).join(" · ") || t`None`}`}</p>
			<p className="text-xs text-ink-3">
				<Trans>
					Phrase and keyword matches are text overlap, not verified salary, workplace or eligibility. AI fit has not
					been assessed. Track, then open Fit for an optional assessment.
				</Trans>
			</p>
			{matches.length + unknowns.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{matches.map((match) => (
						<InfoChip key={match} tone="match">
							{match}
						</InfoChip>
					))}
					{unknowns.map((unknown) => (
						<InfoChip key={unknown} tone="unknown">
							{unknownLabels[unknown]}
						</InfoChip>
					))}
				</div>
			)}
			<Swap id={tracked ? "tracked" : "actions"}>
				{tracked ? (
					<p className="flex min-h-8 items-center gap-2 text-[13px] text-accent-text">
						<Icon name="check-circle" size={18} className="shrink-0" />
						<span className="me-auto">
							<Trans>Saved to Applications with the posting</Trans>
						</span>
						{tracked.undoable && (
							<Button
								variant="ghost"
								size="sm"
								className="text-ink-2 underline underline-offset-3"
								onClick={() => onUndo(tracked.applicationId)}
							>
								<Trans>Undo</Trans>
							</Button>
						)}
					</p>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<Button variant="secondary" className="h-8 px-3 text-[13px]" loading={pending} onClick={() => onTrack(row)}>
							{!pending && <Icon name="bookmark-simple" size={18} />}
							<Trans>Track in Applications</Trans>
						</Button>
						<Button
							variant="ghost"
							nativeButton={false}
							className="h-8 px-2.5 text-[13px] text-ink-2"
							render={<a href={row.url} target="_blank" rel="noopener noreferrer" />}
						>
							<Trans>Read posting</Trans>
							<Icon name="arrow-square-out" size={16} />
						</Button>
						<Button
							disabled={pending}
							variant="ghost"
							className="ms-auto h-8 px-2.5 text-[13px] text-ink-2"
							onClick={() => onDismiss(row)}
						>
							<Trans>Not for me</Trans>
						</Button>
					</div>
				)}
			</Swap>
		</article>
	);
}

// ---- Rail ----

type ComingUpProps = { now: Date; className?: string };

function ComingUp({ now, className }: ComingUpProps) {
	const { format, time, when, relative, locale } = useCareerTime();
	const applicationQuery = useQuery(applicationsListQueryOptions());
	const applications = applicationQuery.data;
	const briefingQuery = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "briefing" } }));
	const briefings = briefingQuery.data;
	if (applicationQuery.isError || briefingQuery.isError)
		return (
			<CareerLoadError
				onRetry={() => {
					void applicationQuery.refetch();
					void briefingQuery.refetch();
				}}
			/>
		);
	if (applicationQuery.isPending || briefingQuery.isPending) return <Skeleton className="h-36 rounded-xl" />;
	const open = (applications ?? []).filter((application) => application.status !== "closed");
	// The next interview in full, then the two after it, so tomorrow's screening isn't hidden behind today's.
	const [next, ...later] = upcomingInterviews(collectInterviews(open), now).slice(0, 3);
	if (!next) return null;

	const { application, interview, start } = next;
	const kind = interviewKindOf(interview.kind)?.label ?? interview.kind;
	const ready = briefings?.some((item) => item.interviewId === interview.id);

	return (
		<section
			aria-labelledby="coming-up"
			className={cn("flex flex-col gap-3 rounded-xl border border-line bg-surface p-4", className)}
		>
			<Eyebrow>
				<span id="coming-up">
					<Trans>Coming up</Trans>
				</span>
			</Eyebrow>
			<div className="flex items-start gap-3">
				<span className="flex w-11 shrink-0 flex-col items-center rounded-lg bg-sunken py-1.5">
					<span className="font-mono text-[11px] font-medium text-ink-3">
						{format(start, { weekday: "short" }).toLocaleUpperCase(locale)}
					</span>
					<span className="font-display text-[22px] leading-[26px] font-medium">
						{format(start, { day: "numeric" })}
					</span>
				</span>
				<div className="grid min-w-0 gap-0.5">
					<p className="flex items-center gap-1.5 text-sm font-semibold">
						<span
							aria-hidden="true"
							className="size-2 shrink-0 rounded-sm"
							style={{ backgroundColor: `var(--stage-${application.status})` }}
						/>
						{t`${kind} interview`}
					</p>
					<p className="text-[13px] text-ink-2">
						{[application.company, time(start), formatDuration(interview.durationMinutes, locale)].join(" · ")}
					</p>
					<p className="text-xs text-ink-3">
						{ready ? `${relative(start, now)} · ${t`Briefing ready`}` : relative(start, now)}
					</p>
				</div>
			</div>
			<Button
				variant="secondary"
				nativeButton={false}
				className="h-8 w-full text-[13px]"
				render={
					<Link
						to="/dashboard/applications/$applicationId/{-$tab}"
						params={{ applicationId: application.id, tab: "prepare" }}
					/>
				}
			>
				<Trans>Open workspace</Trans>
				<Icon name="arrow-right" size={18} className="rtl:-scale-x-100" />
			</Button>
			{later.length > 0 && (
				<ul aria-label={t`Later interviews`} className="grid gap-1 border-t border-line pt-3">
					{later.map((item) => (
						<li key={item.interview.id}>
							<Link
								to="/dashboard/applications/$applicationId/{-$tab}"
								params={{ applicationId: item.application.id, tab: "prepare" }}
								className="flex min-w-0 items-baseline gap-2 rounded-sm text-[13px] hover:underline"
							>
								<span className="shrink-0 text-ink-3">{when(item.start)}</span>
								<span className="truncate text-ink-2">
									{item.application.company} · {interviewKindOf(item.interview.kind)?.label ?? item.interview.kind}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

type SchedulesProps = { deleted: string[]; onOpenSchedule: (schedule: string) => void; className?: string };

const KIND_ORDER = ["discovery", "prepare", "follow-up"];

function Schedules({ deleted, onOpenSchedule, className }: SchedulesProps) {
	const queryClient = useQueryClient();
	const { day, time, when } = useCareerTime();
	const queryKey = orpc.career.schedules.queryKey({ input: {} });
	const { data: schedules, isError, refetch } = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const applicationQuery = useQuery(applicationsListQueryOptions());
	const applications = applicationQuery.data;
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

	const describe = (row: Schedule) => {
		const application = applications?.find((item) => item.id === row.applicationId);
		if (row.kind === "discovery") return row.query;
		if (row.kind === "follow-up")
			return [application ? `${application.company} · ${application.role}` : "", row.query].filter(Boolean).join(" · ");
		const interview = application?.activity.find((entry) => entry.type === "interview" && entry.id === row.interviewId);
		const kind = interview?.type === "interview" ? (interviewKindOf(interview.kind)?.label ?? interview.kind) : null;
		return [application?.company, kind ? t`${kind} interview` : null].filter(Boolean).join(" · ");
	};

	const status = (row: Schedule) => {
		// A one-off's queued run goes by its outcome: still running or retrying, failed after its last try, or done.
		if (!row.intervalDays && row.lastQueuedAt) {
			const run = row.lastRun?.status;
			if (run === "failed") return t`Failed · ${day(row.nextRunAt)} · open to try again`;
			if (run === "queued" || run === "running") return t`Running · ${day(row.nextRunAt)}`;
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
						: t`Every ${days} days at ${clock} · next ${next}`;
		} else if (row.kind === "prepare") {
			const lead = row.lead === "2h" ? t`2 hours before` : row.lead === "morning" ? t`Morning of` : t`24 hours before`;
			line = `${lead} · ${line}`;
		}
		return row.enabled ? line : t`Paused · ${line}`;
	};

	const toggle = (row: Schedule, enabled: boolean) => {
		// A finished one-off reminder has nothing left to run: switching it on means picking a new time.
		if (enabled && !row.intervalDays && row.lastQueuedAt && new Date(row.nextRunAt).getTime() <= Date.now())
			return onOpenSchedule(row.id);
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
		<section
			aria-labelledby="schedules"
			className={cn("overflow-hidden rounded-xl border border-line bg-surface", className)}
		>
			<div className="flex items-center ps-4 pe-2.5 pt-3.5 pb-2.5">
				<Eyebrow className="flex-1">
					<span id="schedules">
						<Trans>Schedules</Trans>
					</span>
				</Eyebrow>
				<Button variant="ghost" size="sm" className="text-ink-2" onClick={() => onOpenSchedule("new")}>
					<Icon name="plus" size={18} />
					<Trans>Add</Trans>
				</Button>
			</div>
			{isError || applicationQuery.isError ? (
				<div className="border-t border-line px-4 py-3">
					<CareerLoadError
						onRetry={() => {
							void refetch();
							void applicationQuery.refetch();
						}}
					/>
				</div>
			) : !rows ? (
				<Skeleton className="mx-4 mb-3 h-24" />
			) : rows.length === 0 ? (
				<EmptyState variant="compact" title={<Trans>Nothing scheduled yet.</Trans>} className="border-t border-line" />
			) : (
				<AnimatePresence initial={false}>
					{rows.map((row) => {
						const { icon, title } = scheduleKind(row.kind);
						const done = !row.intervalDays && Boolean(row.lastQueuedAt);
						const failed = row.lastRun?.status === "failed";
						return (
							<CollapseRow key={row.id} className="border-t border-line">
								<div className="flex items-start gap-3 px-4 py-3">
									<Icon name={icon} size={20} className="mt-px shrink-0 text-ink-2" />
									<button
										type="button"
										onClick={() => onOpenSchedule(row.id)}
										className="grid min-w-0 flex-1 gap-0.5 rounded-sm text-start"
									>
										<span className="text-sm font-semibold">{title}</span>
										<span className="line-clamp-2 text-xs leading-[17px] text-ink-2">{describe(row)}</span>
										<span
											className={cn(
												"text-xs",
												failed ? "text-danger-text" : row.enabled && !done ? "text-accent-text" : "text-ink-3",
											)}
										>
											{status(row)}
										</span>
									</button>
									<Switch
										aria-label={[title, describe(row)].filter(Boolean).join(" · ")}
										checked={row.enabled}
										onCheckedChange={(enabled) => toggle(row, enabled)}
										className="mt-0.5"
									/>
								</div>
							</CollapseRow>
						);
					})}
				</AnimatePresence>
			)}
			<p className="border-t border-line px-4 pt-2.5 pb-3.5 text-xs leading-[17px] text-ink-3">
				<Trans>Reminders appear here. Email copies are optional and need a verified address.</Trans>
			</p>
		</section>
	);
}
