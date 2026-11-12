import type { Kind, Lead, Schedule } from "./schedule-sheet";
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CareerCrumb } from "./career-crumb";
import { CareerLoadError } from "./load-state";
import { rollForward, ScheduleSheet, scheduleKind } from "./schedule-sheet";
import { useCareerTime, withQueryUndo } from "./shared";
import { IconTile, List, ListRow, rowLinkClassName } from "@/components/calm/list-row";
import { Page, PageBody, PageHeader } from "@/components/calm/page";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { interviewKindOf } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { toastError } from "@/libs/error-message";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

const KIND_ORDER = ["discovery", "prepare", "follow-up"];

type ScheduleUrl = { schedule: string | undefined; onScheduleChange: (schedule: string | undefined) => void };

/**
 * The account's schedules in a stable order, with the words each row needs and the switch that pauses one. Deleted
 * schedules stay hidden until their Undo toast closes.
 */
export function useSchedules() {
	const queryClient = useQueryClient();
	const { day, time, when } = useCareerTime();
	const queryKey = orpc.career.schedules.queryKey({ input: {} });
	const query = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const applicationQuery = useQuery(applicationsListQueryOptions());
	const applications = applicationQuery.data;
	const [deleted, setDeleted] = useState<string[]>([]);

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
	const rows = query.data
		?.filter((row) => !deleted.includes(row.id))
		.sort(
			(a, b) =>
				KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
				a.id.localeCompare(b.id),
		);

	const company = (row: Schedule) => applications?.find((item) => item.id === row.applicationId)?.company;
	/** A one-off whose run was queued: it has nothing left to do. */
	const done = (row: Schedule) => !row.intervalDays && Boolean(row.lastQueuedAt);

	/** What it runs for: the search, the interview, the application. */
	const subject = (row: Schedule) => {
		const application = applications?.find((item) => item.id === row.applicationId);
		if (row.kind === "discovery") return row.query;
		if (row.kind === "follow-up") return application ? `${application.company} · ${application.role}` : row.query;
		const interview = application?.activity.find((entry) => entry.type === "interview" && entry.id === row.interviewId);
		const kind = interview?.type === "interview" ? (interviewKindOf(interview.kind)?.label ?? interview.kind) : null;
		return [application?.company, kind ? t`${kind} interview` : null].filter(Boolean).join(" · ");
	};

	/** When it runs next, or how its one run went. */
	const status = (row: Schedule) => {
		if (done(row)) {
			const run = row.lastRun?.status;
			if (run === "failed") return t`Failed · ${day(row.nextRunAt)} · open to check it`;
			if (run === "queued" || run === "running") return t`Running · ${day(row.nextRunAt)}`;
			// A briefing belongs to one interview: once it ran, it's done for that round.
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

	/** Both on one line, for Career's short list: "Lumen · 24 hours before · Mon 9 Nov, 10:00". */
	const summary = (row: Schedule) => {
		const name = company(row);
		if (row.kind === "discovery" || !name) return status(row);
		if (row.kind === "follow-up" && done(row) && row.lastRun?.status !== "failed" && row.lastRun?.status !== "running")
			return t`${name} · done ${day(row.nextRunAt)}`;
		return `${name} · ${status(row)}`;
	};

	/** The switch's name: "Interview preparation for Lumen". */
	const label = (row: Schedule) => {
		const { title } = scheduleKind(row.kind);
		const name = company(row);
		return name ? t`${title} for ${name}` : title;
	};

	const toggle = (row: Schedule, enabled: boolean, open: (id: string) => void) => {
		// A finished one-off reminder has nothing left to run: switching it on means picking a new time.
		if (enabled && done(row) && new Date(row.nextRunAt).getTime() <= Date.now()) return open(row.id);
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

	const remove = (id: string) =>
		withQueryUndo({
			queryClient,
			queryKey: orpc.career.schedules.key(),
			description: t`Schedule deleted`,
			errorMessage: t`Couldn't delete this schedule. Try again.`,
			prepare: () => prepareRpc(client.career.deleteSchedule, { id }),
			hide: () => setDeleted((current) => [...current, id]),
			restore: () => setDeleted((current) => current.filter((item) => item !== id)),
		});

	return {
		rows,
		isError: query.isError || applicationQuery.isError,
		retry: () => {
			void query.refetch();
			void applicationQuery.refetch();
		},
		done,
		subject,
		status,
		summary,
		label,
		toggle,
		remove,
	};
}

type Schedules = ReturnType<typeof useSchedules>;

/** With nothing scheduled, the list is the three kinds a schedule can be, each a way to set one up. */
const kinds = (): { kind: Kind; note: string }[] => [
	{ kind: "discovery", note: t`Looks for new roles from your preferences` },
	{ kind: "prepare", note: t`Writes a briefing before an interview` },
	{ kind: "follow-up", note: t`Reminds you to follow up on an application` },
];

type ScheduleRowsProps = {
	schedules: Schedules;
	onOpen: (schedule: string) => void;
	/** The Schedules page: an icon tile and both quiet lines. Career's short list keeps one line. */
	full?: boolean;
};

/** One row per schedule: what runs, for what, and when next. One switch pauses it; a finished one opens instead. */
export function ScheduleRows({ schedules, onOpen, full = false }: ScheduleRowsProps) {
	const { rows } = schedules;
	const rowClassName = cn(full && "items-start py-3.5");
	const titleClassName = "text-[15px]/[22px] font-medium";
	const tile = (kind: string) =>
		full && (
			<IconTile className="bg-raised text-ink shadow-[inset_0_0_0_1px_var(--line)]">
				<Icon name={scheduleKind(kind).icon} size={20} />
			</IconTile>
		);

	if (schedules.isError) return <CareerLoadError onRetry={schedules.retry} />;
	if (!rows)
		return (
			<List cap={full}>
				{KIND_ORDER.map((kind) => (
					<ListRow key={kind} className={rowClassName}>
						<Skeleton className="h-10 flex-1" />
					</ListRow>
				))}
			</List>
		);
	if (rows.length === 0)
		return (
			<List cap={full}>
				{kinds().map(({ kind, note }) => (
					<ListRow key={kind} interactive leading={tile(kind)} className={rowClassName}>
						<button
							type="button"
							onClick={() => onOpen(`new:${kind}`)}
							className={cn("flex min-w-0 flex-1 flex-col gap-px rounded-xs text-start", rowLinkClassName)}
						>
							<span className={cn(titleClassName, "text-ink")}>{scheduleKind(kind).title}</span>
							<span className="text-[13px]/[18px] text-ink-3">{note}</span>
						</button>
						<span className="text-sm font-medium text-accent-text">
							<Trans>Set up</Trans>
						</span>
					</ListRow>
				))}
			</List>
		);

	return (
		<List cap={full}>
			{rows.map((row) => {
				const { title } = scheduleKind(row.kind);
				const finished = schedules.done(row);
				const failed = row.lastRun?.status === "failed";
				return (
					<ListRow key={row.id} interactive leading={tile(row.kind)} className={rowClassName}>
						<button
							type="button"
							onClick={() => onOpen(row.id)}
							className={cn("flex min-w-0 flex-1 flex-col gap-px rounded-xs text-start", rowLinkClassName)}
						>
							<span className={cn(titleClassName, finished ? "text-ink-3" : "text-ink")}>{title}</span>
							{full ? (
								<>
									<span className="text-[13px]/[18px] text-ink-3">{schedules.subject(row)}</span>
									<span className={cn("text-[13px]/[18px] text-ink-3", failed && "text-danger-text")}>
										{schedules.status(row)}
									</span>
								</>
							) : (
								<span className={cn("truncate text-[13px]/[18px] text-ink-3", failed && "text-danger-text")}>
									{schedules.summary(row)}
								</span>
							)}
						</button>
						{finished ? (
							<Icon name="caret-right" size={18} className={cn("text-ink-3", full && "mt-2.5")} />
						) : (
							<Switch
								aria-label={schedules.label(row)}
								checked={row.enabled}
								onCheckedChange={(enabled) => schedules.toggle(row, enabled, onOpen)}
								className={cn("relative z-10", full && "mt-2")}
							/>
						)}
					</ListRow>
				);
			})}
		</List>
	);
}

/** The sheet for one schedule, keyed by the account so a form never carries over between sign-ins. */
export function ScheduleSheetFor({
	schedule,
	onScheduleChange,
	onDelete,
}: ScheduleUrl & { onDelete: (id: string) => void }) {
	const { session } = useRouteContext({ strict: false });
	return (
		<ScheduleSheet key={session?.user.id} schedule={schedule} onScheduleChange={onScheduleChange} onDelete={onDelete} />
	);
}

/** Career → Schedules: work that runs on a timer, each with a switch; one opens in the sheet. */
export function SchedulesPage({ schedule, onScheduleChange }: ScheduleUrl) {
	const schedules = useSchedules();
	return (
		<Page>
			<PageBody>
				<div className="max-w-[640px]">
					<PageHeader
						crumb={<CareerCrumb />}
						title={<Trans>Schedules</Trans>}
						actions={
							<>
								<Button variant="secondary" aria-expanded={Boolean(schedule)} onClick={() => onScheduleChange("new")}>
									<Icon name="plus" />
									<Trans>New schedule</Trans>
								</Button>
								<PhoneHeaderActions />
							</>
						}
					/>
					<p className="pt-0.5 text-sm/5 text-ink-3">
						<Trans>
							Work that runs on a timer. Results wait in{" "}
							<Link to="/dashboard" className="font-medium text-accent-text">
								Today
							</Link>
							; nothing is sent or created for you.
						</Trans>
					</p>
					<div className="mt-5">
						<ScheduleRows schedules={schedules} onOpen={onScheduleChange} full />
					</div>
					<p className="pt-3.5 text-[13px]/[18px] text-ink-3">
						<Trans>Open a schedule to change or delete it. A paused schedule keeps its settings.</Trans>
					</p>
				</div>
			</PageBody>
			<ScheduleSheetFor schedule={schedule} onScheduleChange={onScheduleChange} onDelete={schedules.remove} />
		</Page>
	);
}
