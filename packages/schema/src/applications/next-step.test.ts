import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { expect, it } from "vite-plus/test";
import { applicationStageSince, compareNextStepSortKeys, getNextStep, nextStepSortKey } from "./next-step";

const now = new Date("2026-10-31T12:00:00Z");
const event = (stage: ApplicationStatus, at: string, canonicalTransition = true): ApplicationTimelineEntry => ({
	id: at,
	type: "stage",
	stage,
	at: new Date(at),
	canonicalTransition,
});
const app = (id: string, stage: ApplicationStatus, at: string, laneAt: string) => ({
	id,
	status: stage,
	appliedAt: new Date("2026-08-01"),
	activity: [event(stage, at), event(stage, laneAt, false)],
	followUpAt: null,
	followUpNote: null,
});
const order = (rows: ReturnType<typeof app>[], direction: "asc" | "desc" = "asc") =>
	rows
		.toSorted((a, b) =>
			compareNextStepSortKeys(nextStepSortKey(a, now), nextStepSortKey(b, now), a.id, b.id, direction),
		)
		.map((row) => row.id);

it.each(["applied", "screening", "interview", "offer"] as const)(
	"lane-only moves preserve the %s clock and stage ordering",
	(status) => {
		const a = app("A", status, "2026-10-01", "2026-10-30");
		const b = app("B", status, "2026-10-21", "2026-10-21");
		expect(order([b, a])).toEqual(["A", "B"]);
		expect(applicationStageSince(a)).toEqual(new Date("2026-10-01"));
		expect(getNextStep(a, now)).toMatchObject({ days: 30 });
		if (status === "applied") expect(getNextStep(a, now).kind).toBe("no-reply");
		a.activity[0] = event(status, "2026-10-25");
		expect(order([a, b])).toEqual(["B", "A"]);
	},
);

it("uses latest canonical re-entry, legacy entries, and appliedAt only when no canonical history exists", () => {
	const a = app("A", "offer", "2026-10-01", "2026-10-30");
	a.activity.push(event("offer", "2026-10-26"));
	expect(applicationStageSince(a)).toEqual(new Date("2026-10-26"));
	a.activity = [{ id: "legacy", type: "stage", stage: "offer", at: new Date("2026-10-09") }];
	expect(applicationStageSince(a)).toEqual(new Date("2026-10-09"));
	a.activity = [event("offer", "2026-10-30", false)];
	expect(applicationStageSince(a)).toEqual(a.appliedAt);
});

it("ranks dated actions first, sorts their dates, and breaks equal keys by stable IDs in either direction", () => {
	const a = app("A", "offer", "2026-10-01", "2026-10-30");
	const b = app("B", "offer", "2026-10-01", "2026-10-21");
	expect(order([b, a])).toEqual(["A", "B"]);
	expect(order([b, a], "desc")).toEqual(["A", "B"]);
	const dated = { ...b, followUpAt: new Date("2026-11-02") };
	expect(nextStepSortKey(dated, now)[0]).toBe(0);
	expect(nextStepSortKey(a, now)[0]).toBe(1);
	expect(compareNextStepSortKeys(nextStepSortKey(dated, now), nextStepSortKey(a, now), dated.id, a.id)).toBeLessThan(0);
	expect(compareNextStepSortKeys([0, 100], [0, 200], "B", "A")).toBeLessThan(0);
});

it("uses only the current Interview visit when deciding whether feedback is due", () => {
	const application = app("A", "interview", "2026-10-25", "2026-10-30");
	const interview: ApplicationTimelineEntry = {
		id: "interview",
		type: "interview",
		at: new Date("2026-10-20T10:00:00Z"),
		kind: "technical",
		durationMinutes: 60,
		location: "",
		notes: "",
		participants: [],
		audience: "practitioner",
		timezone: "UTC",
	};
	application.activity.push(interview);
	expect(getNextStep(application, now).kind).toBe("no-interview");
	application.activity.push({ ...interview, id: "current", at: new Date("2026-10-27T10:00:00Z") });
	expect(getNextStep(application, now).kind).toBe("interview-feedback");
});

it("shares account-clock sorting while preserving explicitly timed midnight follow-ups", () => {
	const application = { ...app("A", "applied", "2026-10-25", "2026-10-30"), followUpAt: new Date("2030-01-03") };
	expect(nextStepSortKey({ ...application, followUpDateOnly: true }, now, "Pacific/Honolulu")).toEqual([
		0,
		new Date("2030-01-03T19:00:00Z").getTime(),
	]);
	expect(nextStepSortKey({ ...application, followUpDateOnly: false }, now, "Pacific/Honolulu")).toEqual([
		0,
		application.followUpAt.getTime(),
	]);
});

it("orders offers by saved reply deadlines before undated decisions, preserving stage age", () => {
	const early = app("early", "offer", "2026-10-21", "2026-10-30");
	const late = app("late", "offer", "2026-10-01", "2026-10-30");
	const earlyHint = { respondBy: "2026-11-01T09:00:00Z" };
	const lateHint = { respondBy: "2026-11-03T09:00:00Z" };
	expect(nextStepSortKey(early, now, "Pacific/Honolulu", earlyHint)).toEqual([0, Date.parse(earlyHint.respondBy)]);
	expect(nextStepSortKey(late, now, "Pacific/Honolulu", lateHint)).toEqual([0, Date.parse(lateHint.respondBy)]);
	expect(
		compareNextStepSortKeys(
			nextStepSortKey(early, now, "UTC", earlyHint),
			nextStepSortKey(late, now, "UTC", lateHint),
			early.id,
			late.id,
		),
	).toBeLessThan(0);
	expect(nextStepSortKey(late, now, "UTC", null)).toEqual([1, Date.parse("2026-10-01")]);
	expect(getNextStep(early, now, "UTC", earlyHint)).toMatchObject({ kind: "offer", days: 10 });
});
