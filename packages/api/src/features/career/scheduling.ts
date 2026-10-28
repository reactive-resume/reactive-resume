/** Preserve local wall time across daily schedules, advancing nonexistent DST times forward. */
export function nextCareerRun(previous: Date, days: number, timezone: string): Date {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
	const local = (date: Date) => {
		const fields = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
		return Date.UTC(
			Number(fields.year),
			Number(fields.month) - 1,
			Number(fields.day),
			Number(fields.hour),
			Number(fields.minute),
			Number(fields.second),
		);
	};
	const target = local(previous) + days * 86_400_000;
	let guess = previous.getTime() + days * 86_400_000;
	let prior = guess;
	for (let i = 0; i < 4; i++) {
		const delta = target - local(new Date(guess));
		if (!delta) return new Date(guess);
		const next = guess + delta;
		if (next === prior) return new Date(Math.max(next, guess));
		prior = guess;
		guess = next;
	}
	return new Date(guess);
}

/** Coalesce overdue occurrences in constant work, retaining the schedule's local time and interval. */
export function nextFutureCareerRun(previous: Date, days: number, timezone: string, now: Date): Date {
	if (!Number.isInteger(days) || days < 1) throw new Error("Invalid schedule interval.");
	const steps = Math.max(1, Math.floor((now.getTime() - previous.getTime()) / (days * 86_400_000)));
	let next = nextCareerRun(previous, steps * days, timezone);
	// Timezone offsets can move the estimate by a day; correct without walking the historical backlog.
	for (let i = 0; i < 3 && next <= now; i++) next = nextCareerRun(next, days, timezone);
	if (!Number.isFinite(next.getTime()) || next <= now) throw new Error("Cannot advance schedule into the future.");
	return next;
}

export function canonicalOpportunityUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			!host.includes(".") ||
			/^[\d.]+$/.test(host) ||
			/(?:^|\.)(localhost|local|internal|lan)$/.test(host) ||
			host.endsWith(".home.arpa")
		)
			return null;
		url.hash = "";
		// A LinkedIn posting's query only tracks the click (refId, trackingId, position, pageNum, trk).
		if (/(?:^|\.)linkedin\.com$/.test(host) && url.pathname.startsWith("/jobs/view/")) url.search = "";
		const trackingKeys = Array.from(url.searchParams.keys()).filter((key) =>
			/^(?:utm_|fbclid$|gclid$|msclkid$|gh_src$|trk$|refid$|trackingid$)/i.test(key),
		);
		for (const key of trackingKeys) url.searchParams.delete(key);
		url.searchParams.sort();
		return url.toString();
	} catch {
		return null;
	}
}

const JOB_BOARDS =
	/^(linkedin|indeed|glassdoor|welcome to the jungle|otta|wellfound|greenhouse|lever|workable|ashby|stepstone|xing|monster)\b/i;

/**
 * Reads "Role at Company", "Role - Company | Board" and "Company: Role" listing titles. Job-board names are dropped;
 * anything unrecognised stays the role, with no company.
 */
export function parseListingTitle(title: string): { role: string; company: string } {
	const parts = title
		// Lookbehinds start each whitespace run once, so long runs stay linear.
		.split(/(?<!\s)\s+[|·–—-]\s+/)
		.map((part) => part.trim())
		.filter((part) => part && !JOB_BOARDS.test(part));
	const at = parts[0]?.match(/^(.+?)(?<!\s)\s+(?:at|@|bei|chez)\s+(.+)$/i);
	if (at) return { role: at[1] ?? "", company: at[2] ?? "" };
	const colon = parts[0]?.match(/^([^:]+):\s*(.+)$/);
	if (parts.length === 1 && colon) return { company: colon[1] ?? "", role: colon[2] ?? "" };
	return { role: parts[0] ?? title.trim(), company: parts[1] ?? "" };
}

/**
 * When a briefing runs: 24 or 2 hours before the interview, or 08:00 on its day in `timezone` (or 2 hours before, for
 * an interview that starts before 10:00).
 */
export function prepareRunAt(interviewAt: Date, lead: "24h" | "2h" | "morning", timezone: string): Date {
	if (lead !== "morning") return new Date(interviewAt.getTime() - (lead === "24h" ? 24 : 2) * 3_600_000);
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});
	const wall = (date: Date) => {
		const f = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, Number(value)]));
		return Date.UTC(f.year ?? 0, (f.month ?? 1) - 1, f.day ?? 1, f.hour ?? 0, f.minute ?? 0);
	};
	const day = new Date(wall(interviewAt));
	const target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 8);
	// Correct by the zone's offset at the answer itself, not at 08:00 UTC, so a clock change that day can't shift it.
	let at = target;
	for (let i = 0; i < 3; i++) at = target - (wall(new Date(at)) - at);
	return new Date(Math.min(at, interviewAt.getTime() - 2 * 3_600_000));
}

/**
 * Search results arrive as page excerpts, sometimes whole pages of markdown. Today shows a short plain summary:
 * links and images reduced to their text, markup and escapes dropped, cut at a word near 320 characters.
 */
export function plainSnippet(text: string, max = 320) {
	const plain = text
		// Neither part crosses a `[`, so a run of unclosed brackets is scanned once rather than once per bracket.
		.replace(/!\[[^[\]]*\]\([^)[]*\)/g, " ")
		.replace(/\[([^[\]]*)\]\([^)[]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, " ")
		.replace(/[\\*_`#>|]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (plain.length <= max) return plain;
	const cut = plain.slice(0, max);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd()}…`;
}
