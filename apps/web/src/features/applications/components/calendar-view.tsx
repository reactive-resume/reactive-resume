import type { ScheduledInterview } from "../interviews";
import type { Application } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
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

const MAX_CHIPS_PER_DAY = 3;

type DialogState =
	| { open: false }
	| { open: true; application: Application | null; interview: InterviewTimelineEntry | null; day: Date | null };

type ApplicationCalendarProps = {
	// Applications matching the page filters; their interviews are shown.
	applications: Application[];
	// Every application, offered by the "schedule interview" picker.
	allApplications: Application[];
	onOpen: (application: Application) => void;
};

export function ApplicationCalendar({ applications, allApplications, onOpen }: ApplicationCalendarProps) {
	const { i18n } = useLingui();
	const locale = i18n.locale;
	const [month, setMonth] = useState(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1);
	});
	// Which way the last month change went: the new month's days slide in from that side. 0 = no change yet.
	const [direction, setDirection] = useState<-1 | 0 | 1>(0);
	const [dialog, setDialog] = useState<DialogState>({ open: false });

	const interviews = collectInterviews(applications);
	const byDay = groupByDay(interviews);
	const upcoming = upcomingInterviews(interviews);
	const upcomingByDay = [...groupByDay(upcoming).values()];
	const days = monthGrid(month);

	// oxlint-disable-next-line react/purity -- Read today on each render so an open calendar updates after midnight when navigated.
	const today = new Date();
	const todayKey = dayKey(today);
	const tomorrowKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
	const isCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
	const monthCount = interviews.filter(
		(item) => item.start.getFullYear() === month.getFullYear() && item.start.getMonth() === month.getMonth(),
	).length;

	const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: "short" });
	const monthFormat = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
	const timeFormat = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
	const dayHeadingFormat = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" });

	const goToMonth = (next: Date) => {
		setDirection(next > month ? 1 : -1);
		setMonth(next);
	};
	const shiftMonth = (delta: number) => goToMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
	const schedule = (day: Date | null = null) => setDialog({ open: true, application: null, interview: null, day });
	const edit = (item: ScheduledInterview) =>
		setDialog({ open: true, application: item.application, interview: item.interview, day: null });

	const dayHeading = (date: Date) => {
		const key = dayKey(date);
		if (key === todayKey) return t`Today`;
		if (key === tomorrowKey) return t`Tomorrow`;
		return dayHeadingFormat.format(date);
	};

	return (
		<div className="flex min-h-0 flex-1 gap-6 max-lg:flex-col max-lg:overflow-y-auto">
			<section className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto" data-testid="interview-calendar">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<div className="flex items-baseline gap-2">
						<h2 className="text-lg font-semibold capitalize">{monthFormat.format(month)}</h2>
						<span className="text-sm text-ink-3">
							{monthCount === 0 ? (
								<Trans>No interviews</Trans>
							) : monthCount === 1 ? (
								<Trans>1 interview</Trans>
							) : (
								<Trans>{monthCount} interviews</Trans>
							)}
						</span>
					</div>

					<div className="ms-auto flex items-center gap-1">
						<Button size="icon-sm" variant="ghost" title={t`Previous month`} onClick={() => shiftMonth(-1)}>
							<Icon name="chevron_left" size={16} />
						</Button>
						<Button
							size="sm"
							variant="secondary"
							disabled={isCurrentMonth}
							onClick={() => goToMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
						>
							<Trans>This month</Trans>
						</Button>
						<Button size="icon-sm" variant="ghost" title={t`Next month`} onClick={() => shiftMonth(1)}>
							<Icon name="chevron_right" size={16} />
						</Button>
						<Button size="sm" className="ms-2" onClick={() => schedule()}>
							<Icon name="calendar_add_on" size={16} />
							<Trans>Schedule interview</Trans>
						</Button>
					</div>
				</div>

				<div className="shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
					<div className="grid grid-cols-7">
						{days.slice(0, 7).map((day) => (
							<div
								key={`weekday-${day.getDay()}`}
								className="border-b border-line p-2 text-center text-[11px] font-medium tracking-wide text-ink-3 uppercase"
							>
								{weekdayFormat.format(day)}
							</div>
						))}
					</div>
					<div
						key={`${month.getFullYear()}-${month.getMonth()}`}
						className={cn(
							"grid grid-cols-7",
							direction !== 0 && "transition-[opacity,translate] duration-standard ease-enter starting:opacity-0",
							direction === 1 && "starting:translate-x-2 rtl:starting:-translate-x-2",
							direction === -1 && "starting:-translate-x-2 rtl:starting:translate-x-2",
						)}
					>
						{days.map((day, i) => {
							const key = dayKey(day);
							const items = byDay.get(key) ?? [];
							const inMonth = day.getMonth() === month.getMonth();
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
											onClick={() => schedule(day)}
										>
											<Icon name="add" size={14} />
										</button>
										<span
											className={cn(
												"flex size-6 items-center justify-center rounded-full text-xs",
												!inMonth && "text-ink-3/60",
												isToday && "bg-accent font-semibold text-on-accent",
											)}
										>
											{day.getDate()}
										</span>
									</div>
									{items.slice(0, MAX_CHIPS_PER_DAY).map((item) => (
										<InterviewChip
											key={item.interview.id}
											item={item}
											time={timeFormat.format(item.start)}
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
												<p className="px-1 pb-1 text-xs font-medium">{dayHeading(day)}</p>
												{items.map((item) => (
													<InterviewChip
														key={item.interview.id}
														item={item}
														time={timeFormat.format(item.start)}
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

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
					{INTERVIEW_KINDS.map((kind) => (
						<span key={kind.value} className="flex items-center gap-1.5">
							<span className="size-2 rounded-full" style={{ background: kind.color }} />
							{kind.label}
						</span>
					))}
				</div>
			</section>

			<aside className="flex shrink-0 flex-col gap-4 lg:w-80 lg:overflow-y-auto">
				<h3 className="text-sm font-semibold">
					<Trans>Upcoming interviews</Trans>
				</h3>

				{upcoming.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-4 py-8 text-center">
						<div className="flex size-10 items-center justify-center rounded-full bg-sunken">
							<Icon name="calendar_today" size={20} className="text-ink-3" />
						</div>
						<div className="space-y-1">
							<p className="text-sm font-medium">
								<Trans>Nothing scheduled yet</Trans>
							</p>
							<p className="text-xs text-ink-3">
								<Trans>Add screening calls and technical interviews to see them here and on the calendar.</Trans>
							</p>
						</div>
						<Button size="sm" variant="secondary" onClick={() => schedule()}>
							<Icon name="calendar_add_on" size={16} />
							<Trans>Schedule interview</Trans>
						</Button>
					</div>
				) : (
					upcomingByDay.map((group) => {
						const first = group[0];
						if (!first) return null;
						return (
							<div key={dayKey(first.start)} className="flex flex-col gap-2">
								<h4 className="text-xs font-medium text-ink-3">{dayHeading(first.start)}</h4>
								{group.map((item) => (
									<UpcomingCard
										key={item.interview.id}
										item={item}
										timeRange={`${timeFormat.format(item.start)} – ${timeFormat.format(item.end)}`}
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
			className="relative overflow-hidden rounded-xl border border-line bg-surface ps-4 text-sm"
		>
			<span className="absolute inset-y-0 start-0 w-1" style={{ background: kind?.color }} />
			<button type="button" className="block w-full py-3 pe-3 text-start hover:opacity-80" onClick={onEdit}>
				<span className="flex items-center justify-between gap-2 text-xs">
					<span className="font-medium">{timeRange}</span>
					<span className="text-ink-3">{formatDuration(item.interview.durationMinutes, locale)}</span>
				</span>
				<span className="mt-1 block truncate font-semibold">{item.application.company}</span>
				<span className="block truncate text-xs text-ink-3">
					{kind?.label ?? item.interview.kind} · {item.application.role}
				</span>
				{item.interview.location && (
					<span className="mt-1.5 flex items-center gap-1 text-xs text-ink-3">
						<Icon name="location_on" size={16} className="shrink-0" />
						<span className="truncate">{item.interview.location}</span>
					</span>
				)}
			</button>
			<button type="button" className="mb-2 text-xs text-accent-text hover:underline" onClick={onOpenApplication}>
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
			<span className="size-2 shrink-0 rounded-full sm:hidden" style={{ background: kind?.color }} />
			<span className="flex min-w-0 items-baseline gap-1.5 max-sm:hidden">
				<span className="shrink-0 text-ink-3 tabular-nums">{time}</span>
				<span className="truncate font-medium">{item.application.company}</span>
			</span>
		</button>
	);
}
