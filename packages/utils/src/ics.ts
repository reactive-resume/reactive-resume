export type CalendarEvent = {
	uid: string;
	title: string;
	start: Date;
	end: Date;
	location?: string;
	description?: string;
	/** A reminder this many minutes before the start (interviews use 60). */
	alarmMinutes?: number;
};

// RFC 5545: commas, semicolons and backslashes are escaped, line breaks become \n.
const escapeText = (value: string) =>
	value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const utcStamp = (date: Date) =>
	date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");

const octets = (char: string) => {
	const code = char.codePointAt(0) ?? 0;
	return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

// RFC 5545 §3.1: lines longer than 75 octets of UTF-8 fold onto continuation lines that start with a space.
// Folds between code points, so a multi-byte character or surrogate pair is never split.
function fold(line: string) {
	const parts: string[] = [];
	let current = "";
	let size = 0;
	for (const char of line) {
		const width = octets(char);
		if (size + width > 75) {
			parts.push(current);
			current = " ";
			size = 1;
		}
		current += char;
		size += width;
	}
	parts.push(current);
	return parts.join("\r\n");
}

/** One or more events as an .ics file's text, in UTC, for "Add to calendar". */
export function buildIcs(
	event: CalendarEvent | CalendarEvent[],
	now = new Date(),
	method: "PUBLISH" | "CANCEL" = "PUBLISH",
): string {
	const events = Array.isArray(event) ? event : [event];
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Reactive Resume//Applications//EN",
		"CALSCALE:GREGORIAN",
		// A re-downloaded file updates the event it replaces: same UID, a higher SEQUENCE (seconds since 1970).
		`METHOD:${method}`,
		...events.flatMap((item) => [
			"BEGIN:VEVENT",
			`UID:${item.uid}@reactive-resume`,
			// A cancellation supersedes a publish exported in the same second.
			`SEQUENCE:${Math.floor(now.getTime() / 1000) + (method === "CANCEL" ? 1 : 0)}`,
			...(method === "CANCEL" ? ["STATUS:CANCELLED"] : []),
			`DTSTAMP:${utcStamp(now)}`,
			`DTSTART:${utcStamp(item.start)}`,
			`DTEND:${utcStamp(item.end)}`,
			`SUMMARY:${escapeText(item.title)}`,
			...(item.location ? [`LOCATION:${escapeText(item.location)}`] : []),
			...(item.description ? [`DESCRIPTION:${escapeText(item.description)}`] : []),
			...(method !== "CANCEL" && item.alarmMinutes
				? [
						"BEGIN:VALARM",
						"ACTION:DISPLAY",
						`TRIGGER:-PT${item.alarmMinutes}M`,
						`DESCRIPTION:${escapeText(item.title)}`,
						"END:VALARM",
					]
				: []),
			"END:VEVENT",
		]),
		"END:VCALENDAR",
	];

	return `${lines.map(fold).join("\r\n")}\r\n`;
}
