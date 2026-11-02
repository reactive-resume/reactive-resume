import type { ScheduledInterview } from "../interviews";
import type { ApplicationSummary } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useState } from "react";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import {
	collectInterviews,
	dayKey,
	formatDuration,
	groupByDay,
	interviewKindOf,
	monthGrid,
	upcomingInterviews,
} from "../interviews";
import { InterviewDialog } from "./interview-dialog";
import { useCareerTime, useNow } from "@/features/career/shared";

const MAX_CHIPS_PER_DAY = 3;

type DialogState =
	| { open: false }
	| {
			open: true;
			application: ApplicationSummary | null;
			interview: InterviewTimelineEntry | null;
			day: string | null;
	  };

type ApplicationCalendarProps = {
	compact: boolean;
	// Applications matching the page filters; their interviews are shown.
	applications: ApplicationSummary[];
	// Every application, offered by the "schedule interview" picker.
	allApplications: ApplicationSummary[];
	onOpen: (application: ApplicationSummary) => void;
};

export function ApplicationCalendar({ compact, applications, allApplications, onOpen }: ApplicationCalendarProps) {
	const { locale, timeZone, plainTime, timeRange } = useCareerTime();
	const now = useNow();
	const todayKey = dayKey(now, timeZone);
	// Grid dates are civil days carried in UTC; interview start/end remain absolute instants.
	const today = new Date(`${todayKey}T00:00:00Z`);
	const currentMonth = new Date(`${todayKey.slice(0, 7)}-01T00:00:00Z`);
	const [browsedMonth, setBrowsedMonth] = useState<Date | null>(null);
	const month = browsedMonth ?? currentMonth;
	// Which way the last month change went: the new month's days slide in from that side. 0 = no change yet.
	const [direction, setDirection] = useState<-1 | 0 | 1>(0);
	const [dialog, setDialog] = useState<DialogState>({ open: false });

	const interviews = collectInterviews(applications);
	const byDay = groupByDay(interviews, timeZone);
	const upcoming = upcomingInterviews(interviews, now);
	const days = monthGrid(month);

	const tomorrowKey = dayKey(new Date(today.getTime() + 86_400_000), "UTC");
	const monthKey = dayKey(month, "UTC").slice(0, 7);
	const monthInterviews = interviews.filter((item) => dayKey(item.start, timeZone).startsWith(monthKey));
	const monthCount = monthInterviews.length;
	const monthAgenda = compact && browsedMonth !== null;
	const agenda = monthAgenda ? monthInterviews : upcoming;
	const agendaByDay = [...groupByDay(agenda, timeZone).values()];

	const weekdayFormat = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
	const monthFormat = new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" });
	const dayHeadingFormat = new Intl.DateTimeFormat(locale, {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
	});

	const goToMonth = (next: Date | null) => {
		setDirection((next ?? currentMonth) > month ? 1 : -1);
		setBrowsedMonth(next);
	};
	const shiftMonth = (delta: number) =>
		goToMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));
	const schedule = (day: string | null = null) => setDialog({ open: true, application: null, interview: null, day });
	const edit = (item: ScheduledInterview) =>
		setDialog({ open: true, application: item.application, interview: item.interview, day: null });

	const dayHeading = (key: string) => {
		if (key === todayKey) return t`Today`;
		if (key === tomorrowKey) return t`Tomorrow`;
		return dayHeadingFormat.format(new Date(`${key}T00:00:00Z`));
	};

	return (
		<div className="flex min-h-0 min-w-0 flex-1 gap-6 max-lg:flex-col max-lg:overflow-y-auto">
			<section
				className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 lg:overflow-y-auto"
				data-testid="interview-calendar"
			>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<div className="flex flex-wrap items-baseline gap-2">
						<h2 className="text-lg font-semibold capitalize">{monthFormat.format(month)}</h2>
						<span className="text-sm text-ink-3">
							<Plural value={monthCount} _0="No interviews" one="# interview" other="# interviews" />
						</span>
					</div>

					<div className="ms-auto flex flex-wrap items-center gap-1">
						<Button size="icon-sm" variant="ghost" title={t`Previous month`} onClick={() => shiftMonth(-1)}>
							<Icon name="caret-left" size={16} />
						</Button>
						<Button size="sm" variant="secondary" disabled={browsedMonth === null} onClick={() => goToMonth(null)}>
							<Trans>This month</Trans>
						</Button>
						<Button size="icon-sm" variant="ghost" title={t`Next month`} onClick={() => shiftMonth(1)}>
							<Icon name="caret-right" size={16} />
						</Button>
						{/* Secondary: the page's one accent-filled action is Save job, in the header. */}
						<Button size="sm" variant="secondary" className="ms-2" onClick={() => schedule()}>
							<Icon name="calendar-plus" size={16} />
							<Trans>Schedule interview</Trans>
						</Button>
					</div>
				</div>

				{!compact && (
					<div
						className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface"
						data-testid="interview-month-grid"
					>
						<div className="grid grid-cols-7">
							{days.slice(0, 7).map((day) => (
								<div
									key={`weekday-${day.getUTCDay()}`}
									className="border-b border-line p-2 text-center text-xs font-medium text-ink-3"
								>
									{weekdayFormat.format(day)}
								</div>
							))}
						</div>
						<div
							key={monthKey}
							className={cn(
								"grid grid-cols-7",
								direction !== 0 && "transition-[opacity,translate] duration-standard ease-enter starting:opacity-0",
								direction === 1 && "starting:translate-x-2 rtl:starting:-translate-x-2",
								direction === -1 && "starting:-translate-x-2 rtl:starting:translate-x-2",
							)}
						>
							{days.map((day, i) => {
								const key = dayKey(day, "UTC");
								const items = byDay.get(key) ?? [];
								const inMonth = day.getUTCMonth() === month.getUTCMonth();
								const isToday = key === todayKey;
								const extra = items.length - MAX_CHIPS_PER_DAY;
								const date = dayHeadingFormat.format(day);
								const scheduleLabel = t`Schedule an interview on ${date}`;
								return (
									<div
										key={key}
										data-day={key}
										className={cn(
											"group/day relative flex min-h-16 flex-col gap-1 border-line p-1 sm:min-h-24 sm:p-1.5",
											i % 7 !== 6 && "border-e",
											i < 35 && "border-b",
											!inMonth && "bg-sunken/30",
										)}
									>
										<div className="flex items-center justify-between">
											<button
												type="button"
												title={scheduleLabel}
												aria-label={scheduleLabel}
												className="flex size-6 items-center justify-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover/day:opacity-100 hover:bg-sunken hover:text-ink focus-visible:opacity-100 max-sm:hidden"
												onClick={() => schedule(key)}
											>
												<Icon name="plus" size={14} />
											</button>
											<span
												className={cn(
													"flex size-6 items-center justify-center rounded-sm text-xs",
													!inMonth && "text-ink-3",
													isToday && "bg-accent font-semibold text-on-accent",
												)}
											>
												{day.getUTCDate()}
											</span>
										</div>
										{items.slice(0, MAX_CHIPS_PER_DAY).map((item) => (
											<InterviewChip
												key={item.interview.id}
												item={item}
												time={plainTime(item.start)}
												onOpen={() => edit(item)}
											/>
										))}
										{extra > 0 && (
											<Popover>
												<PopoverTrigger
													render={
														<button
															type="button"
															className="self-start rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
														/>
													}
												>
													<Trans>+{extra} more</Trans>
												</PopoverTrigger>
												<PopoverContent align="start" className="flex w-60 flex-col gap-1 p-2">
													<p className="px-1 pb-1 text-xs font-medium">{dayHeading(key)}</p>
													{items.map((item) => (
														<InterviewChip
															key={item.interview.id}
															item={item}
															time={plainTime(item.start)}
															onOpen={() => edit(item)}
														/>
													))}
												</PopoverContent>
											</Popover>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				{!compact && (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
						{INTERVIEW_KINDS.map((kind) => (
							<span key={kind.value} className="flex items-center gap-1.5">
								<span className="size-2 rounded-sm" style={{ background: kind.color }} />
								{kind.label}
							</span>
						))}
					</div>
				)}
			</section>

			<aside className="flex min-w-0 shrink-0 flex-col gap-4 lg:w-80 lg:overflow-y-auto" data-testid="interview-agenda">
				<h2 className="text-sm font-semibold">
					{monthAgenda ? <Trans>Interviews</Trans> : <Trans>Upcoming interviews</Trans>}
				</h2>

				{agenda.length === 0 ? (
					<EmptyState
						title={<Trans>Nothing scheduled yet</Trans>}
						description={
							<Trans>Add screening calls and technical interviews to see them here and on the calendar.</Trans>
						}
						action={
							<Button size="sm" variant="secondary" onClick={() => schedule()}>
								<Icon name="calendar-plus" size={16} />
								<Trans>Schedule interview</Trans>
							</Button>
						}
					/>
				) : (
					agendaByDay.map((group) => {
						const first = group[0];
						if (!first) return null;
						return (
							<div key={dayKey(first.start, timeZone)} className="flex flex-col gap-2">
								<h4 className="text-xs font-medium text-ink-3">{dayHeading(dayKey(first.start, timeZone))}</h4>
								{group.map((item) => (
									<UpcomingCard
										key={item.interview.id}
										item={item}
										timeRange={timeRange(item.start, item.end)}
										locale={locale}
										onEdit={() => edit(item)}
										onOpenApplication={() => onOpen(item.application)}
									/>
								))}
							</div>
						);
					})
				)}
			</aside>

			<InterviewDialog
				open={dialog.open}
				onOpenChange={(open) => !open && setDialog({ open: false })}
				application={dialog.open ? dialog.application : null}
				applications={allApplications}
				interview={dialog.open ? dialog.interview : null}
				day={dialog.open ? dialog.day : null}
			/>
		</div>
	);
}

type UpcomingCardProps = {
	item: ScheduledInterview;
	timeRange: string;
	locale: string;
	onEdit: () => void;
	onOpenApplication: () => void;
};

function UpcomingCard({ item, timeRange, locale, onEdit, onOpenApplication }: UpcomingCardProps) {
	const kind = interviewKindOf(item.interview.kind);
	return (
		<div
			data-upcoming-interview={item.interview.id}
			data-application-id={item.application.id}
			className="relative overflow-hidden rounded-xl border border-line bg-surface ps-4 text-sm"
		>
			<span className="absolute inset-y-0 start-0 w-1" style={{ background: kind?.color }} />
			<button type="button" className="block w-full py-3 pe-3 text-start hover:opacity-80" onClick={onEdit}>
				<span className="flex flex-wrap items-center justify-between gap-2 text-xs">
					<span className="font-medium">{timeRange}</span>
					<span className="text-ink-3">{formatDuration(item.interview.durationMinutes, locale)}</span>
				</span>
				<span dir="auto" className="mt-1 block truncate font-semibold">
					{item.application.company}
				</span>
				<span className="block truncate text-xs text-ink-3">
					{kind?.label ?? item.interview.kind} · <bdi>{item.application.role}</bdi>
				</span>
				{item.interview.location && (
					<span className="mt-1.5 flex items-center gap-1 text-xs text-ink-3">
						<Icon name="map-pin" size={16} className="shrink-0" />
						<span className="truncate">{item.interview.location}</span>
					</span>
				)}
			</button>
			<button
				type="button"
				data-application-open
				className="mb-2 min-h-11 px-2 text-xs text-accent-text hover:underline"
				onClick={onOpenApplication}
			>
				<Trans>View application</Trans>
			</button>
		</div>
	);
}

type InterviewChipProps = {
	item: ScheduledInterview;
	time: string;
	onOpen: () => void;
};

function InterviewChip({ item, time, onOpen }: InterviewChipProps) {
	const kind = interviewKindOf(item.interview.kind);
	return (
		<button
			type="button"
			title={`${time} · ${kind?.label ?? item.interview.kind} · ${item.application.company} — ${item.application.role}`}
			className="flex min-w-0 items-center gap-1.5 rounded-md border-s-2 bg-sunken/60 px-1.5 py-0.5 text-start text-[11px] leading-tight transition-colors hover:bg-sunken max-sm:justify-center max-sm:border-s-0 max-sm:bg-transparent"
			style={{ borderInlineStartColor: kind?.color }}
			onClick={onOpen}
		>
			<span className="size-2 shrink-0 rounded-sm sm:hidden" style={{ background: kind?.color }} />
			<span className="flex min-w-0 items-baseline gap-1.5 max-sm:hidden">
				<span className="shrink-0 text-ink-3 tabular-nums">{time}</span>
				<span dir="auto" className="truncate font-medium">
					{item.application.company}
				</span>
			</span>
		</button>
	);
}
