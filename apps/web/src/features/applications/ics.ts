type CalendarEvent = {
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

// Lines longer than 75 octets fold onto continuation lines that start with a space.
function fold(line: string) {
	const parts: string[] = [];
	let rest = line;
	while (rest.length > 75) {
		parts.push(rest.slice(0, 75));
		rest = ` ${rest.slice(75)}`;
	}
	parts.push(rest);
	return parts.join("\r\n");
}

/** One or more events as an .ics file's text, in UTC, for "Add to calendar". */
export function buildIcs(event: CalendarEvent | CalendarEvent[], now = new Date()): string {
	const events = Array.isArray(event) ? event : [event];
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Reactive Resume//Applications//EN",
		"CALSCALE:GREGORIAN",
		// A re-downloaded file updates the event it replaces: same UID, a higher SEQUENCE (seconds since 1970).
		"METHOD:PUBLISH",
		...events.flatMap((item) => [
			"BEGIN:VEVENT",
			`UID:${item.uid}@reactive-resume`,
			`SEQUENCE:${Math.floor(now.getTime() / 1000)}`,
			`DTSTAMP:${utcStamp(now)}`,
			`DTSTART:${utcStamp(item.start)}`,
			`DTEND:${utcStamp(item.end)}`,
			`SUMMARY:${escapeText(item.title)}`,
			...(item.location ? [`LOCATION:${escapeText(item.location)}`] : []),
			...(item.description ? [`DESCRIPTION:${escapeText(item.description)}`] : []),
			...(item.alarmMinutes
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
