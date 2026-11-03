import { describe, expect, it } from "vite-plus/test";
import { buildIcs } from "./ics";

describe("buildIcs", () => {
	it("writes one UTC event with escaped text and CRLF lines", () => {
		const ics = buildIcs(
			{
				uid: "i1",
				title: "Panel interview, Lumen",
				start: new Date("2026-10-02T12:00:00Z"),
				end: new Date("2026-10-02T13:00:00Z"),
				location: "Berlin; Room 4",
				description: "Bring the portfolio\\nand notes",
				alarmMinutes: 60,
			},
			new Date("2026-09-28T08:30:00Z"),
		);

		expect(ics.split("\r\n")).toEqual([
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Reactive Resume//Applications//EN",
			"CALSCALE:GREGORIAN",
			"METHOD:PUBLISH",
			"BEGIN:VEVENT",
			"UID:i1@reactive-resume",
			// A later download supersedes this one: same UID, higher SEQUENCE.
			"SEQUENCE:1790584200",
			"DTSTAMP:20260928T083000Z",
			"DTSTART:20261002T120000Z",
			"DTEND:20261002T130000Z",
			"SUMMARY:Panel interview\\, Lumen",
			"LOCATION:Berlin\\; Room 4",
			"DESCRIPTION:Bring the portfolio\\\\nand notes",
			"BEGIN:VALARM",
			"ACTION:DISPLAY",
			"TRIGGER:-PT60M",
			"DESCRIPTION:Panel interview\\, Lumen",
			"END:VALARM",
			"END:VEVENT",
			"END:VCALENDAR",
			"",
		]);
	});

	it("folds long lines at 75 characters", () => {
		const ics = buildIcs({ uid: "x", title: "A".repeat(100), start: new Date(0), end: new Date(0) });
		const summary = ics.split("\r\n").filter((line) => line.startsWith("SUMMARY") || line.startsWith(" "));
		expect(summary[0]).toHaveLength(75);
		expect(summary[1]?.startsWith(" ")).toBe(true);
	});
});

it("writes a cancellation for the original event identity, superseding a same-second publish without an alarm", () => {
	const event = {
		uid: "original-round",
		title: "Panel",
		start: new Date("2027-03-27T10:00:00Z"),
		end: new Date("2027-03-27T11:00:00Z"),
		alarmMinutes: 60,
	};
	const now = new Date("2026-11-03T12:00:00Z");
	const published = buildIcs(event, now);
	const canceled = buildIcs(event, now, "CANCEL");
	const line = (ics: string, property: string) => ics.split("\r\n").find((value) => value.startsWith(property + ":"));
	expect(line(canceled, "UID")).toBe(line(published, "UID"));
	expect(canceled).toContain("METHOD:CANCEL\r\n");
	expect(canceled).toContain("STATUS:CANCELLED\r\n");
	expect(canceled).not.toContain("BEGIN:VALARM");
	expect(Number(line(canceled, "SEQUENCE")?.split(":")[1])).toBeGreaterThan(
		Number(line(published, "SEQUENCE")?.split(":")[1]),
	);
});

it("folds international calendar text by UTF-8 octets without splitting code points", () => {
	const title = "Résumé 会議 😀 ".repeat(20);
	const ics = buildIcs({ uid: "unicode", title, start: new Date(0), end: new Date(0) });
	for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
	expect(ics.replace(/\r\n /g, "")).toContain(`SUMMARY:${title}\r\n`);
});
