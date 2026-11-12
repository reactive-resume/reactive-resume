import type { CalendarEntry } from "../calendar";
import type { ApplicationSummary } from "../types";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import { collectCalendarEntries, monthWeeks } from "../calendar";
import { dayKey } from "../interviews";
import { getCategoryLane, getDisplayLane, getLaneLabel, laneDotColor } from "../lanes";
import { interviewStepTitle, stepTime } from "../next-step";
import { useOfferHints } from "../queries";
import { getStageColor } from "../stages";
import { useApplicationLanes } from "../use-application-lanes";
import { InterviewDialog } from "./interview-dialog";
import { DateColumn, List, ListRow } from "@/components/calm/list-row";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
import { useCareerTime, useNow } from "@/features/career/shared";

const MAX_ENTRIES_PER_DAY = 3;
const DAY_MS = 86_400_000;
// The stages a dated entry can belong to: a saved job has no dates yet, and closed ones are left out.
const LEGEND = ["applied", "screening", "interview", "offer"] as const;

type ApplicationCalendarProps = {
	compact: boolean;
	// Applications matching the page filters; their dates are shown.
	applications: ApplicationSummary[];
	// Every application, offered by the "schedule interview" picker.
	allApplications: ApplicationSummary[];
	onClearFilters?: (() => void) | undefined;
};

/**
 * Everything with a date: interviews, follow-ups and offer deadlines, in a month grid (Monday first, 24-hour times)
 * and in "Coming up" beside it. An entry opens its application; a day schedules an interview on it. Phones get the
 * list alone, for the month being browsed or for what's coming up.
 */
export function ApplicationCalendar({
	compact,
	applications,
	allApplications,
	onClearFilters,
}: ApplicationCalendarProps) {
	const { locale, timeZone } = useCareerTime();
	const now = useNow();
	const offers = useOfferHints();
	const todayKey = dayKey(now, timeZone);
	// Grid dates are civil days carried in UTC; entries remain absolute instants.
	const currentMonth = new Date(`${todayKey.slice(0, 7)}-01T00:00:00Z`);
	const [browsedMonth, setBrowsedMonth] = useState<Date | null>(null);
	const month = browsedMonth ?? currentMonth;
	// Which way the last month change went: the new month's days slide in from that side. 0 = no change yet.
	const [direction, setDirection] = useState<-1 | 0 | 1>(0);
	// null: closed; a day key: scheduling on that day; "": scheduling with no day chosen.
	const [scheduling, setScheduling] = useState<string | null>(null);

	const entries = collectCalendarEntries(applications, offers, now, timeZone);
	const byDay = new Map<string, CalendarEntry[]>();
	for (const entry of entries) {
		const key = dayKey(entry.at, timeZone);
		byDay.set(key, [...(byDay.get(key) ?? []), entry]);
	}
	// What is still ahead, plus what is owed: an overdue follow-up or deadline stays until it's dealt with.
	const comingUp = entries.filter((entry) => !entry.past);
	const days = monthWeeks(month);
	const monthKey = dayKey(month, "UTC").slice(0, 7);
	const monthAgenda = compact && browsedMonth !== null;
	const agenda = monthAgenda ? entries.filter((entry) => dayKey(entry.at, timeZone).startsWith(monthKey)) : comingUp;

	const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...options });
	const weekdayFormat = utc({ weekday: "short" });
	const monthFormat = utc({ month: "long", year: "numeric" });
	const shortMonthFormat = utc({ month: "short" });
	const dayFormat = utc({ weekday: "long", month: "long", day: "numeric" });

	const goToMonth = (next: Date | null) => {
		setDirection((next ?? currentMonth) > month ? 1 : -1);
		setBrowsedMonth(next);
	};
	const shiftMonth = (delta: number) =>
		goToMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1)));

	const agendaList =
		agenda.length === 0 ? (
			<EmptyState
				variant="compact"
				title={onClearFilters ? <Trans>Nothing matches your filters.</Trans> : <Trans>Nothing scheduled yet.</Trans>}
				action={
					onClearFilters && (
						<Button size="sm" variant="ghost" onClick={onClearFilters}>
							<Trans>Clear filters</Trans>
						</Button>
					)
				}
			/>
		) : (
			<List cap>
				{agenda.map((entry) => (
					<AgendaRow key={entry.id} entry={entry} now={now} />
				))}
			</List>
		);

	return (
		<div className="mt-4 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_264px]">
			<section className="flex min-w-0 flex-col" data-testid="interview-calendar">
				<div className="flex min-h-9 flex-wrap items-center gap-1">
					<h2 className="font-display text-[22px]/7 first-letter:uppercase">
						{compact && !monthAgenda ? <Trans>Coming up</Trans> : monthFormat.format(month)}
					</h2>
					<span className="flex-1" />
					<IconButton icon="caret-left" label={t`Previous month`} onClick={() => shiftMonth(-1)} />
					<Button size="sm" variant="ghost" onClick={() => browsedMonth && goToMonth(null)}>
						<Trans>Today</Trans>
					</Button>
					<IconButton icon="caret-right" label={t`Next month`} onClick={() => shiftMonth(1)} />
					{/* Secondary: the page's one accent action is Save a job, in the header. */}
					<Button variant="secondary" className="ms-2" onClick={() => setScheduling("")}>
						<Icon name="calendar-plus" />
						<Trans>Schedule interview</Trans>
					</Button>
				</div>

				{!compact && (
					<>
						<div
							role="group"
							aria-label={monthFormat.format(month)}
							className="mt-2.5 grid grid-cols-7"
							data-testid="interview-month-grid"
						>
							{days.slice(0, 7).map((day) => (
								<span
									key={`weekday-${day.getUTCDay()}`}
									className="border-b border-line px-1.5 pb-2 text-xs font-medium text-ink-3"
								>
									{weekdayFormat.format(day)}
								</span>
							))}
							<div
								key={monthKey}
								className={cn(
									"col-span-full grid grid-cols-subgrid",
									direction !== 0 && "transition-[opacity,translate] duration-standard ease-enter starting:opacity-0",
									direction === 1 && "starting:translate-x-2 rtl:starting:-translate-x-2",
									direction === -1 && "starting:-translate-x-2 rtl:starting:translate-x-2",
								)}
							>
								{days.map((day, index) => {
									const key = dayKey(day, "UTC");
									const items = byDay.get(key) ?? [];
									const inMonth = day.getUTCMonth() === month.getUTCMonth();
									const isToday = key === todayKey;
									const quiet = !inMonth || key < todayKey;
									const extra = items.length - MAX_ENTRIES_PER_DAY;
									return (
										<div
											key={key}
											data-day={key}
											className="relative flex min-h-[88px] min-w-0 flex-col gap-[5px] border-b border-line px-1.5 pt-1.5 pb-2"
										>
											<button
												type="button"
												aria-label={t`Schedule an interview on ${dayFormat.format(day)}`}
												onClick={() => setScheduling(key)}
												className="absolute inset-0 rounded-sm transition-colors hover:bg-hover"
											/>
											<span
												className={cn(
													"pointer-events-none relative flex h-[22px] items-center gap-1.5 text-[13px]/[22px]",
													quiet ? "text-ink-3" : "font-medium text-ink",
												)}
											>
												<span
													className={cn(
														isToday &&
															"-ms-[5px] inline-flex size-[22px] items-center justify-center rounded-full bg-ink font-semibold text-bg",
													)}
												>
													{i18n.number(day.getUTCDate())}
												</span>
												{isToday ? (
													<small className="text-xs/4 font-normal text-ink-3">
														<Trans>Today</Trans>
													</small>
												) : (
													// The first day shown, and the first of a month, say which month they are in.
													(index === 0 || (day.getUTCDate() === 1 && !inMonth)) && (
														<small className="text-xs/4 font-normal text-ink-3">{shortMonthFormat.format(day)}</small>
													)
												)}
											</span>
											{items.slice(0, MAX_ENTRIES_PER_DAY).map((entry) => (
												<GridEntry key={entry.id} entry={entry} />
											))}
											{extra > 0 && (
												<Popover>
													<PopoverTrigger
														render={
															<button
																type="button"
																className="relative self-start rounded-xs text-[11px]/[14px] text-ink-3 transition-colors hover:text-ink"
															/>
														}
													>
														<Trans>+{extra} more</Trans>
													</PopoverTrigger>
													<PopoverContent align="start" className="flex w-60 flex-col gap-2 p-3">
														<p className="text-xs font-medium">{dayFormat.format(day)}</p>
														{items.map((entry) => (
															<GridEntry key={entry.id} entry={entry} />
														))}
													</PopoverContent>
												</Popover>
											)}
										</div>
									);
								})}
							</div>
						</div>

						<p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs/4 text-ink-3">
							<Legend />
							<span className="flex-1" />
							<span>
								<Trans>The bar shows the application's stage · times in {timeZone}</Trans>
							</span>
						</p>
					</>
				)}

				{compact && (
					<div className="mt-2" data-testid="interview-agenda">
						{agendaList}
					</div>
				)}
			</section>

			{!compact && (
				<aside className="flex min-w-0 flex-col" data-testid="interview-agenda">
					<SectionHeading first note={i18n.number(comingUp.length)} className="min-h-9 items-center p-0">
						<Trans>Coming up</Trans>
					</SectionHeading>
					{/* Its first hairline sits on the line under the weekday names. */}
					<div className="mt-[34px]">{agendaList}</div>
				</aside>
			)}

			<InterviewDialog
				open={scheduling !== null}
				onOpenChange={(open) => !open && setScheduling(null)}
				application={null}
				applications={allApplications}
				interview={null}
				day={scheduling || null}
			/>
		</div>
	);
}

function Legend() {
	const { lanes } = useApplicationLanes();
	return LEGEND.map((status) => {
		const lane = getCategoryLane(lanes, status);
		return (
			<StageDot key={status} status={status} color={laneDotColor(lane)}>
				{getLaneLabel(lane)}
			</StageDot>
		);
	});
}

const applicationLink = (application: ApplicationSummary) =>
	({
		to: "/dashboard/applications/$applicationId/{-$tab}",
		params: { applicationId: application.id },
	}) as const;

/** An entry in a day of the grid: the company, then what and when. Its bar is the colour of the application's stage. */
function GridEntry({ entry }: { entry: CalendarEntry }) {
	const { locale, timeZone } = useCareerTime();
	const { lanes } = useApplicationLanes();
	const { application } = entry;
	const time = stepTime(entry.at, locale, timeZone);
	const what =
		entry.kind === "interview"
			? entry.interview.kind === "screening"
				? t`Screening ${time}`
				: t`Interview ${time}`
			: entry.kind === "offer"
				? t`Offer deadline`
				: entry.overdue
					? t`Follow-up due`
					: t`Follow-up`;

	return (
		<Link
			{...applicationLink(application)}
			data-application-id={application.id}
			data-application-open
			title={entry.kind === "interview" ? `${interviewStepTitle(entry.interview.kind)} · ${time}` : undefined}
			className="relative flex min-w-0 flex-col border-s-[3px] ps-1.5 whitespace-nowrap"
			style={{
				borderInlineStartColor: laneDotColor(getDisplayLane(lanes, application)) ?? getStageColor(application.status),
			}}
		>
			<b
				dir="auto"
				className={cn("truncate text-xs/4", entry.past ? "font-normal text-ink-2" : "font-medium text-ink")}
			>
				{application.company}
			</b>
			<span
				className={cn(
					"truncate text-[11px]/[14px]",
					entry.kind !== "interview" && entry.overdue ? "text-warn-text" : "text-ink-3",
				)}
			>
				{what}
			</span>
		</Link>
	);
}

/** A row of "Coming up": the day, the company, what it is and when, then where or who, or that it needs you. */
function AgendaRow({ entry, now }: { entry: CalendarEntry; now: Date }) {
	const { locale, timeZone, format } = useCareerTime();
	const { application } = entry;
	const time = stepTime(entry.at, locale, timeZone);
	const lateDays = Math.round((Date.parse(dayKey(now, timeZone)) - Date.parse(dayKey(entry.at, timeZone))) / DAY_MS);
	const late = plural(lateDays, { one: "# day overdue", other: "# days overdue" });

	let what: string;
	let detail = "";
	if (entry.kind === "interview") {
		what = `${interviewStepTitle(entry.interview.kind)} · ${time}–${stepTime(entry.end, locale, timeZone)}`;
		const people = entry.interview.participants.map((person) => person.name).filter(Boolean);
		detail =
			people.length > 0
				? t`With ${new Intl.ListFormat(locale, { type: "conjunction" }).format(people)}`
				: entry.interview.location;
	} else if (entry.kind === "follow-up") {
		const note = application.followUpNote || t`Send a follow-up`;
		what = entry.overdue && lateDays > 0 ? `${note} · ${late}` : entry.overdue ? t`${note} · due today` : note;
	} else {
		// A deadline at the last minute of the day was entered as a date.
		const by = time === "23:59" ? t`by end of day` : t`by ${time}`;
		what = entry.overdue && lateDays > 0 ? t`Reply to the offer · ${late}` : t`Reply to the offer · ${by}`;
	}
	// Owed today or tomorrow, as the list's "Needs you": a follow-up that is due, or any offer waiting for an answer.
	const owed = entry.kind === "offer" || (entry.kind === "follow-up" && entry.at.getTime() - now.getTime() <= DAY_MS);

	return (
		<ListRow
			render={<Link {...applicationLink(application)} />}
			data-application-id={application.id}
			data-application-open
			{...(entry.kind === "interview" ? { "data-upcoming-interview": entry.interview.id } : {})}
			className="items-start py-3"
			leading={
				<DateColumn
					day={format(entry.at, { day: "numeric" })}
					label={format(entry.at, { weekday: "short" })}
					className="flex-col-reverse pt-px"
				/>
			}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-px">
				<span dir="auto" className="truncate text-[15px]/[22px] font-medium text-ink">
					{application.company}
				</span>
				<span className="text-[13px]/[18px] text-ink-3">{what}</span>
				{detail && <span className="text-[13px]/[18px] text-ink-3">{detail}</span>}
				{owed && (
					<span className="flex pt-1">
						<Badge variant="warn">
							<Trans>Needs you</Trans>
						</Badge>
					</span>
				)}
			</span>
		</ListRow>
	);
}
