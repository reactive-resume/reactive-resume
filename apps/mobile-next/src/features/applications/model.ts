// What the Applications screens show, derived from the data hooks: stage names, list groups, the one line per row,
// board cards, the calendar agenda and the Insights numbers. Pure functions; times are read in the given zone.
import type { RouterOutput } from "@/api/client";
import type {
	ApplicationClosedReason,
	ApplicationStatus,
	InterviewTimelineEntry,
} from "@reactive-resume/schema/applications/data";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { applicationStageSince, getNextStep, latestOfferHints } from "@reactive-resume/schema/applications/next-step";
import { computeOutcomes } from "@reactive-resume/schema/applications/outcomes";

export type Application = RouterOutput["applications"]["getById"];
export type ApplicationRow = RouterOutput["applications"]["list"][number];
export type SavedItem = RouterOutput["career"]["savedItems"][number];

/** The stages an application moves through, in order; Closed ends it from any of them (web `PIPELINE`). */
export const PIPELINE = [
	"saved",
	"applied",
	"screening",
	"interview",
	"offer",
] as const satisfies readonly ApplicationStatus[];
/** Board columns: the pipeline, then Closed. */
export const BOARD_ORDER = [...PIPELINE, "closed"] as const satisfies readonly ApplicationStatus[];
/** The list's group order: what needs you first, closed last (web `LIST_ORDER`). */
export const LIST_ORDER = [
	"interview",
	"offer",
	"screening",
	"applied",
	"saved",
] as const satisfies readonly ApplicationStatus[];
export const CLOSED_REASONS = [
	"accepted",
	"accepted-other",
	"not-selected",
	"withdrew",
	"no-response",
] as const satisfies readonly ApplicationClosedReason[];

export const stageLabel = (status: ApplicationStatus) =>
	({
		saved: t`Saved`,
		applied: t`Applied`,
		screening: t({ comment: "Application stage: the first recruiter screen after applying.", message: "Screening" }),
		interview: t`Interviewing`,
		offer: t`Offer`,
		closed: t`Closed`,
	})[status];

/** J9's outcomes in the person's words; Insights and the Closed list use the same names. */
export const outcomeLabel = (reason: ApplicationClosedReason) =>
	({
		accepted: t`I accepted this offer`,
		"accepted-other": t`I accepted another offer`,
		"not-selected": t`Not selected`,
		withdrew: t`I withdrew`,
		"no-response": t`No response`,
	})[reason];

/** J6's stage line for a closed application: "Closed · Accepted this offer". */
export const closedLine = (reason: ApplicationClosedReason | null) =>
	reason
		? t`Closed · ${
				{
					accepted: t`Accepted this offer`,
					"accepted-other": t`Accepted another offer`,
					"not-selected": t`Not selected`,
					withdrew: t`Withdrew`,
					"no-response": t`No response`,
				}[reason]
			}`
		: t`Closed`;

export const interviewTitle = (kind: string) =>
	({
		screening: t`Screening call`,
		technical: t`Technical interview`,
		behavioral: t`Behavioral interview`,
		onsite: t`Onsite interview`,
		other: t`Interview`,
	})[kind] ?? kind;

/** Short kind for cards ("technical"); unknown stored values show as their text. */
export const interviewKindWord = (kind: string) =>
	({
		screening: t`screening`,
		technical: t`technical`,
		behavioral: t`behavioral`,
		onsite: t`onsite`,
		other: t`interview`,
	})[kind] ?? kind;

// ponytail: English renders day-first ("Tue 10 Nov") as the storyboard and the web's en-GB output; other locales use
// their own order.
const dateLocale = () => (i18n.locale?.startsWith("en") ? "en-GB" : i18n.locale || "en-GB");
const fmt = (date: Date, zone: string, options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat(dateLocale(), { timeZone: zone, ...options }).format(date).replace(",", "");

/** "Tue 10 Nov" */
export const shortDay = (date: Date, zone: string) =>
	fmt(date, zone, { weekday: "short", day: "numeric", month: "short" });
/** "2 Nov" */
export const dayMonth = (date: Date, zone: string) => fmt(date, zone, { day: "numeric", month: "short" });
/** "Tuesday 10 November" */
export const longDay = (date: Date, zone: string) =>
	fmt(date, zone, { weekday: "long", day: "numeric", month: "long" });
/** "Tuesday 10 Nov" */
export const longWeekday = (date: Date, zone: string) =>
	fmt(date, zone, { weekday: "long", day: "numeric", month: "short" });
/** "Friday" */
export const weekday = (date: Date, zone: string) => fmt(date, zone, { weekday: "long" });
/** "10:00" */
export const clockTime = (date: Date, zone: string) =>
	new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
		date,
	);
/** The zone's city: "Europe/Berlin" → "Berlin". */
export const zoneCity = (zone: string) => (zone.split("/").pop() ?? zone).replaceAll("_", " ");
/** "CET" / "CEST" for the instant. */
export const zoneAbbreviation = (date: Date, zone: string) =>
	new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
		.formatToParts(date)
		.find((part) => part.type === "timeZoneName")?.value ?? zone;
/** The calendar date in the zone, "2026-11-10". */
export const isoDay = (date: Date, zone: string) =>
	new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

const DAY_MS = 86_400_000;

/** Two letters for the monogram: the first letters of the first two words, or the first two letters of one word. */
export function monogram(company: string) {
	const words = company.split(/\s+/).filter((word) => /\p{L}/u.test(word));
	const letters =
		words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : company.replace(/[^\p{L}]/gu, "").slice(0, 2);
	return letters.toLocaleUpperCase();
}

const interviews = (app: Pick<ApplicationRow, "activity">) =>
	app.activity.filter((entry): entry is InterviewTimelineEntry => entry.type === "interview");

/** The next interview that hasn't ended. */
export function nextInterview(app: Pick<ApplicationRow, "activity">, now: Date) {
	return interviews(app)
		.filter((entry) => new Date(entry.at).getTime() + entry.durationMinutes * 60_000 >= now.getTime())
		.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0];
}

export const isLink = (value: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(value.trim());

/** Where an interview happens, as a row reads it: a meeting link reads "Video call". */
export const whereLabel = (location: string) => (isLink(location) ? t`Video call` : location);

const respondByOf = (offers: ReadonlyMap<string, { respondBy: string | null }>, id: string) => {
	const value = offers.get(id)?.respondBy;
	return value ? new Date(value) : null;
};

export type ListContext = { now: Date; zone: string; offers: ReadonlyMap<string, { respondBy: string | null }> };

export const offerHints = (items: readonly SavedItem[] | undefined) =>
	latestOfferHints(
		(items ?? []).map((item) => ({ ...item, data: item.data as { kind: string; respondBy?: string | null } })),
	);

/** The one thing that matters next, as J1's second line. */
export function rowLine(app: ApplicationRow, { now, zone, offers }: ListContext): string {
	if (app.status === "closed") return app.closedReason ? outcomeLabel(app.closedReason) : t`Closed`;
	const interview = nextInterview(app, now);
	if (interview) return `${interviewTitle(interview.kind)} · ${shortDay(new Date(interview.at), zone)}`;
	if (app.status === "offer") {
		const by = respondByOf(offers, app.id);
		if (!by) return t`Decide on the offer`;
		const soon = by.getTime() - now.getTime() < 7 * DAY_MS;
		return t`Reply to the offer by ${soon ? weekday(by, zone) : shortDay(by, zone)}`;
	}
	if (app.status === "saved") return t`Saved ${dayMonth(new Date(app.createdAt), zone)}`;
	const step = getNextStep(app, now, zone, offers.get(app.id) ?? null);
	const applied = t`Applied ${dayMonth(new Date(app.appliedAt), zone)}`;
	return step.kind === "no-reply" ? t`${applied} · no reply yet` : applied;
}

/** J2's third card line. */
export function cardLine(app: ApplicationRow, { now, zone, offers }: ListContext): string | undefined {
	const interview = nextInterview(app, now);
	if (interview) return `${shortDay(new Date(interview.at), zone)} · ${interviewKindWord(interview.kind)}`;
	if (app.status === "offer") {
		const by = respondByOf(offers, app.id);
		return by ? t`Reply by ${shortDay(by, zone)}` : undefined;
	}
	if (app.status === "saved" || app.status === "closed") return undefined;
	return t`Applied ${shortDay(new Date(app.appliedAt), zone)}`;
}

/** Row titles: company, plus the role when two open applications share the company ("Lumen · Design lead"). */
export function rowTitles(apps: readonly ApplicationRow[]) {
	const counts = new Map<string, number>();
	for (const app of apps) counts.set(app.company, (counts.get(app.company) ?? 0) + 1);
	return new Map(
		apps.map((app) => [app.id, (counts.get(app.company) ?? 0) > 1 ? `${app.company} · ${app.role}` : app.company]),
	);
}

/** J1's groups: open stages in LIST_ORDER with their rows, most advanced first; closed ones counted apart. */
export function groupByStage(apps: readonly ApplicationRow[], context: ListContext) {
	const open = apps.filter((app) => app.status !== "closed");
	const groups = LIST_ORDER.map((status) => ({
		status,
		rows: open
			.filter((app) => app.status === status)
			.sort((a, b) => sortTime(a, context) - sortTime(b, context) || a.id.localeCompare(b.id)),
	})).filter((group) => group.rows.length > 0);
	return { groups, closed: apps.filter((app) => app.status === "closed") };
}

/** Soonest dated step first (interviews, offer deadlines), then longest wait. */
function sortTime(app: ApplicationRow, { now, offers }: ListContext) {
	const interview = nextInterview(app, now);
	if (interview) return new Date(interview.at).getTime();
	const by = respondByOf(offers, app.id);
	if (by) return by.getTime();
	return applicationStageSince(app)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** When the application entered a stage, from its stage history (the applied date for Applied). */
export function stageDate(app: Pick<ApplicationRow, "activity" | "appliedAt" | "status">, status: ApplicationStatus) {
	const entry = app.activity
		.filter((item) => item.type === "stage" && item.stage === status)
		.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
	if (entry) return new Date(entry.at);
	if (status === "applied" && app.status !== "saved") return new Date(app.appliedAt);
	return null;
}

export type AgendaItem = {
	key: string;
	day: string;
	at: Date | null;
	title: string;
	line: string;
	applicationId: string;
	kind: "interview" | "follow-up" | "deadline";
};

/** Interviews, follow-ups and offer deadlines, by day (J3). */
export function agendaItems(apps: readonly ApplicationRow[], { zone, offers }: ListContext): AgendaItem[] {
	const items: AgendaItem[] = [];
	for (const app of apps) {
		if (app.status === "closed") continue;
		for (const interview of interviews(app)) {
			const at = new Date(interview.at);
			const people = interview.participants.map((person) => person.name);
			const where = interview.location ? whereLabel(interview.location) : "";
			const line = [where, people[0] ? t`with ${people[0]}` : ""].filter(Boolean).join(" · ");
			items.push({
				key: interview.id,
				day: isoDay(at, zone),
				at,
				title: `${app.company} · ${interviewTitle(interview.kind)}`,
				line,
				applicationId: app.id,
				kind: "interview",
			});
		}
		if (app.followUpAt) {
			const at = new Date(app.followUpAt);
			items.push({
				key: `${app.id}-follow-up`,
				day: isoDay(at, zone),
				at: app.followUpDateOnly ? null : at,
				title: t`Follow up with ${app.company}`,
				line: app.followUpNote || t`Reminder`,
				applicationId: app.id,
				kind: "follow-up",
			});
		}
		const by = app.status === "offer" ? respondByOf(offers, app.id) : null;
		if (by)
			items.push({
				key: `${app.id}-deadline`,
				day: isoDay(by, zone),
				at: null,
				title: t`${app.company} · Offer deadline`,
				line: t`Reply by end of day`,
				applicationId: app.id,
				kind: "deadline",
			});
	}
	return items.sort(
		(a, b) => a.day.localeCompare(b.day) || (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity),
	);
}

/** The seven days (Mon–Sun) of the week holding `day`, as ISO dates. */
export function weekOf(day: string) {
	const date = new Date(`${day}T12:00:00Z`);
	const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS);
	return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * DAY_MS).toISOString().slice(0, 10));
}
export const addDays = (day: string, n: number) =>
	new Date(new Date(`${day}T12:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
/** Days of a day's month grid, Monday first, padded to whole weeks. */
export function monthGrid(day: string) {
	const first = `${day.slice(0, 7)}-01`;
	const start = weekOf(first)[0] ?? first;
	const next = new Date(`${first}T12:00:00Z`);
	next.setUTCMonth(next.getUTCMonth() + 1);
	const days: string[] = [];
	for (let d = start; d < next.toISOString().slice(0, 10) || days.length % 7; d = addDays(d, 1)) days.push(d);
	return days;
}
/** "9–15 Nov" (or "30 Nov – 6 Dec"). */
export function weekRange(days: readonly string[]) {
	const [first, last] = [days[0] ?? "", days[days.length - 1] ?? ""];
	const a = new Date(`${first}T12:00:00Z`);
	const b = new Date(`${last}T12:00:00Z`);
	return a.getUTCMonth() === b.getUTCMonth()
		? `${a.getUTCDate()}–${dayMonth(b, "UTC")}`
		: `${dayMonth(a, "UTC")} – ${dayMonth(b, "UTC")}`;
}
export const dayDate = (day: string) => new Date(`${day}T12:00:00Z`);

export type InsightsRange = "30" | "90" | "all";

/** J4: three numbers, the funnel, and replies by where the application came from. */
export function insights(apps: readonly ApplicationRow[], range: InsightsRange, now: Date) {
	const since = range === "all" ? -Infinity : now.getTime() - Number(range) * DAY_MS;
	const inRange = apps.filter((app) => new Date(app.appliedAt).getTime() >= since);
	const outcomes = computeOutcomes(inRange, (app) => app.resumeId !== null && !!app.sentResumeVersionId);
	const reached = (status: ApplicationStatus) => outcomes.funnel.find((row) => row.status === status)?.reached ?? 0;
	const replied = (app: ApplicationRow) =>
		app.activity.some((entry) => entry.type === "stage" && ["screening", "interview", "offer"].includes(entry.stage)) ||
		["screening", "interview", "offer"].includes(app.status);
	const sources = new Map<string, { applied: number; replied: number }>();
	for (const app of inRange) {
		if (!app.source || app.status === "saved") continue;
		const row = sources.get(app.source) ?? { applied: 0, replied: 0 };
		row.applied++;
		if (replied(app)) row.replied++;
		sources.set(app.source, row);
	}
	return {
		sent: outcomes.sent,
		repliedShare: outcomes.sent ? Math.round((outcomes.heardBack / outcomes.sent) * 100) : null,
		medianDays: outcomes.medianDaysToReply,
		funnel: [
			{ label: t`Applied`, count: outcomes.sent },
			{ label: t`Replied`, count: outcomes.heardBack },
			{ label: t`Interviewed`, count: reached("interview") },
			{ label: t`Offer`, count: reached("offer") },
		],
		sources: [...sources].map(([source, row]) => ({ source, ...row })).sort((a, b) => a.applied - b.applied),
	};
}

/** The stage an application was at before it closed (where Reopen returns it); null when unknown. */
export function stageBeforeClose(app: Pick<ApplicationRow, "activity">): ApplicationStatus | null {
	const entries = app.activity
		.flatMap((entry) => (entry.type === "stage" && entry.stage !== "closed" ? [entry] : []))
		.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
	return entries[0]?.stage ?? null;
}
