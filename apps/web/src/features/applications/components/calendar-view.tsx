import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ScheduledInterview } from "../interviews";
import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	CalendarBlankIcon,
	CalendarPlusIcon,
	CaretLeftIcon,
	CaretRightIcon,
	MapPinIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
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
	const [dialog, setDialog] = useState<DialogState>({ open: false });

	const interviews = useMemo(() => collectInterviews(applications), [applications]);
	const byDay = useMemo(() => groupByDay(interviews), [interviews]);
	const upcoming = useMemo(() => upcomingInterviews(interviews), [interviews]);
	const upcomingByDay = useMemo(() => [...groupByDay(upcoming).values()], [upcoming]);
	const days = useMemo(() => monthGrid(month), [month]);

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

	const shiftMonth = (delta: number) => setMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
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
						<h2 className="font-semibold text-lg capitalize">{monthFormat.format(month)}</h2>
						<span className="text-muted-foreground text-sm">
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
							<CaretLeftIcon />
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={isCurrentMonth}
							onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}
						>
							<Trans>This month</Trans>
						</Button>
						<Button size="icon-sm" variant="ghost" title={t`Next month`} onClick={() => shiftMonth(1)}>
							<CaretRightIcon />
						</Button>
						<Button size="sm" className="ms-2" onClick={() => schedule()}>
							<CalendarPlusIcon />
							<Trans>Schedule interview</Trans>
						</Button>
					</div>
				</div>

				<div className="grid shrink-0 grid-cols-7 overflow-hidden rounded-xl border border-border bg-card">
					{days.slice(0, 7).map((day) => (
						<div
							key={`weekday-${day.getDay()}`}
							className="border-border border-b px-2 py-2 text-center font-medium text-[11px] text-muted-foreground uppercase tracking-wide"
						>
							{weekdayFormat.format(day)}
						</div>
					))}

					{days.map((day, i) => {
						const key = dayKey(day);
						const items = byDay.get(key) ?? [];
						const inMonth = day.getMonth() === month.getMonth();
						const isToday = key === todayKey;
						const extra = items.length - MAX_CHIPS_PER_DAY;
						return (
							<div
								key={key}
								data-day={key}
								className={cn(
									"group/day relative flex min-h-16 flex-col gap-1 border-border p-1 sm:min-h-24 sm:p-1.5",
									i % 7 !== 6 && "border-e",
									i < 35 && "border-b",
									!inMonth && "bg-muted/30",
								)}
							>
								<div className="flex items-center justify-between">
									<button
										type="button"
										title={t`Schedule an interview on this day`}
										className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/day:opacity-100 max-sm:hidden"
										onClick={() => schedule(day)}
									>
										<PlusIcon className="size-3.5" />
									</button>
									<span
										className={cn(
											"flex size-6 items-center justify-center rounded-full text-xs",
											!inMonth && "text-muted-foreground/60",
											isToday && "bg-primary font-semibold text-primary-foreground",
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
													className="self-start rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
												/>
											}
										>
											<Trans>+{extra} more</Trans>
										</PopoverTrigger>
										<PopoverContent align="start" className="flex w-60 flex-col gap-1 p-2">
											<p className="px-1 pb-1 font-medium text-xs">{dayHeading(day)}</p>
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

				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
					{INTERVIEW_KINDS.map((kind) => (
						<span key={kind.value} className="flex items-center gap-1.5">
							<span className="size-2 rounded-full" style={{ background: kind.color }} />
							{kind.label}
						</span>
					))}
				</div>
			</section>

			<aside className="flex shrink-0 flex-col gap-4 lg:w-80 lg:overflow-y-auto">
				<h3 className="font-semibold text-sm">
					<Trans>Upcoming interviews</Trans>
				</h3>

				{upcoming.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-xl border border-border border-dashed px-4 py-8 text-center">
						<div className="flex size-10 items-center justify-center rounded-full bg-muted">
							<CalendarBlankIcon className="size-5 text-muted-foreground" />
						</div>
						<div className="space-y-1">
							<p className="font-medium text-sm">
								<Trans>Nothing scheduled yet</Trans>
							</p>
							<p className="text-muted-foreground text-xs">
								<Trans>Add screening calls and technical interviews to see them here and on the calendar.</Trans>
							</p>
						</div>
						<Button size="sm" variant="outline" onClick={() => schedule()}>
							<CalendarPlusIcon />
							<Trans>Schedule interview</Trans>
						</Button>
					</div>
				) : (
					upcomingByDay.map((group) => {
						const first = group[0];
						if (!first) return null;
						return (
							<div key={dayKey(first.start)} className="flex flex-col gap-2">
								<h4 className="font-medium text-muted-foreground text-xs">{dayHeading(first.start)}</h4>
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
			className="relative overflow-hidden rounded-xl border border-border bg-card ps-4 text-sm"
		>
			<span className="absolute inset-y-0 start-0 w-1" style={{ background: kind?.color }} />
			<button type="button" className="block w-full py-3 pe-3 text-start hover:opacity-80" onClick={onEdit}>
				<span className="flex items-center justify-between gap-2 text-xs">
					<span className="font-medium">{timeRange}</span>
					<span className="text-muted-foreground">{formatDuration(item.interview.durationMinutes, locale)}</span>
				</span>
				<span className="mt-1 block truncate font-semibold">{item.application.company}</span>
				<span className="block truncate text-muted-foreground text-xs">
					{kind?.label ?? item.interview.kind} · {item.application.role}
				</span>
				{item.interview.location && (
					<span className="mt-1.5 flex items-center gap-1 text-muted-foreground text-xs">
						<MapPinIcon className="shrink-0" />
						<span className="truncate">{item.interview.location}</span>
					</span>
				)}
			</button>
			<button type="button" className="mb-2 text-primary text-xs hover:underline" onClick={onOpenApplication}>
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
			className="flex min-w-0 items-center gap-1.5 rounded-md border-s-2 bg-muted/60 px-1.5 py-0.5 text-start text-[11px] leading-tight hover:bg-muted max-sm:justify-center max-sm:border-s-0 max-sm:bg-transparent"
			style={{ borderInlineStartColor: kind?.color }}
			onClick={onOpen}
		>
			<span className="size-2 shrink-0 rounded-full sm:hidden" style={{ background: kind?.color }} />
			<span className="flex min-w-0 items-baseline gap-1.5 max-sm:hidden">
				<span className="shrink-0 text-muted-foreground tabular-nums">{time}</span>
				<span className="truncate font-medium">{item.application.company}</span>
			</span>
		</button>
	);
}
