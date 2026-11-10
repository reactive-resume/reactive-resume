let fixedNow: Date | undefined;
let fixedZone: string | undefined;
export const now = (): Date => new Date(fixedNow?.getTime() ?? Date.now());
export const timeZone = (): string => fixedZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
export function setNow(value?: Date | string | number): void {
	const next = value === undefined ? undefined : new Date(value);
	if (next && !Number.isFinite(next.getTime())) throw new Error("Invalid instant.");
	fixedNow = next;
}
export function setTimeZone(value?: string): void {
	if (value) new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
	fixedZone = value;
}
export function zonedParts(instant: Date, zone = timeZone()) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: zone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(instant);
	const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
	return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
/** Returns zero choices for a skipped hour, two for a repeated one. Never silently chooses an instant. */
export function wallTimeChoices(
	date: string,
	time: string,
	zone = timeZone(),
): { instant: Date; zone: string; label: string }[] {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Invalid local time.");
	new Intl.DateTimeFormat("en", { timeZone: zone });
	const center = Date.parse(`${date}T${time}:00Z`);
	if (!Number.isFinite(center)) throw new Error("Invalid local time.");
	const choices: Date[] = [];
	for (let minutes = -14 * 60; minutes <= 14 * 60; minutes++) {
		const instant = new Date(center + minutes * 60_000);
		const local = zonedParts(instant, zone);
		if (local.date === date && local.time === time) choices.push(instant);
	}
	return choices.map((instant, index) => {
		const name = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "short" })
			.formatToParts(instant)
			.find((p) => p.type === "timeZoneName")?.value;
		// The offset from the wall time itself: Hermes doesn't support timeZoneName "shortOffset".
		const local = zonedParts(instant, zone);
		const minutes = Math.round((Date.parse(`${local.date}T${local.time}:00Z`) - instant.getTime()) / 60_000);
		const abs = Math.abs(minutes);
		const pad = (n: number) => String(n).padStart(2, "0");
		const padded = `UTC${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}${abs % 60 ? `:${pad(abs % 60)}` : ""}`;
		return {
			instant,
			zone,
			label: `${time} ${name}, ${padded}${choices.length > 1 ? (index === 0 ? " (first)" : " (second)") : ""}`,
		};
	});
}
