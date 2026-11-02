import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { expect, it } from "vite-plus/test";
import { applicationStageSince, compareNextStepSortKeys, getNextStep, nextStepSortKey } from "./next-step";
import { computeOutcomes } from "./outcomes";

const now = new Date("2026-10-31T12:00:00Z");
const event = (
	stage: ApplicationStatus,
	at: string,
	canonicalTransition = true,
): Extract<ApplicationTimelineEntry, { type: "stage" }> => ({
	id: at,
	type: "stage",
	stage,
	at: new Date(at),
	canonicalTransition,
});
const app = (id: string, stage: ApplicationStatus, at: string, laneAt: string) => {
	const activity: ApplicationTimelineEntry[] = [event(stage, at), event(stage, laneAt, false)];
	return { id, status: stage, appliedAt: new Date("2026-08-01"), activity, followUpAt: null, followUpNote: null };
};
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
		if (status === "applied" || status === "screening") expect(getNextStep(a, now).kind).toBe("no-reply");
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

it("nudges after silence following the last interview, counted from its end", () => {
	const interview = (at: string): ApplicationTimelineEntry =>
		({
			id: `i-${at}`,
			type: "interview",
			at: new Date(at),
			durationMinutes: 60,
			kind: "technical",
		}) as ApplicationTimelineEntry;
	const quiet = {
		...app("A", "interview", "2026-10-01", "2026-10-01"),
		activity: [event("interview", "2026-10-01"), interview("2026-10-05T10:00:00Z")],
	};
	expect(getNextStep(quiet, now)).toMatchObject({ kind: "no-reply", after: "interview", days: 26 });
	const recent = { ...quiet, activity: [event("interview", "2026-10-01"), interview("2026-10-28T10:00:00Z")] };
	expect(getNextStep(recent, now).kind).toBe("interview-feedback");
});

it("keeps an undated imported stage out of elapsed-time and no-reply claims", () => {
	const application = {
		status: "applied" as const,
		appliedAt: new Date("2026-01-01"),
		followUpAt: null,
		followUpNote: null,
		activity: [
			{
				id: "imported",
				type: "stage" as const,
				stage: "applied" as const,
				at: new Date("2026-01-01"),
				dateUnknown: true,
			},
		],
	};
	expect(applicationStageSince(application)).toBeNull();
	expect(getNextStep(application, new Date("2026-10-01"))).toEqual({ kind: "waiting", days: null });
});

const contact = (at: string, stageEntryId: string | null): ApplicationTimelineEntry => ({
	id: `contact-${at}`,
	type: "note",
	text: "Followed up",
	at: new Date(at),
	followedUp: { stageEntryId },
});

it.each(["applied", "screening"] as const)(
	"followed-up contact resets %s silence, preserving stage age and outcomes",
	(status) => {
		const application = { ...app("A", status, "2026-10-01", "2026-10-30"), resumeId: null, closedReason: null };
		const before = computeOutcomes([application], () => false);
		application.activity.push({ id: "plain", type: "note", text: "Followed up", at: now });
		expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: 30 });
		application.activity.push(contact("2026-10-25T12:00:00Z", "2026-10-01"));
		expect(getNextStep(application, now)).toEqual({ kind: "waiting", days: 30 });
		expect(getNextStep(application, new Date("2026-11-04T12:00:00Z"))).toEqual({ kind: "no-reply", days: 10 });
		expect(applicationStageSince(application)).toEqual(new Date("2026-10-01"));
		expect(computeOutcomes([application], () => false)).toEqual(before);
		expect(
			getNextStep({ ...application, followUpAt: new Date("2026-10-29"), followUpNote: "Keep reminder" }, now),
		).toMatchObject({ kind: "follow-up", note: "Keep reminder", overdue: true });
	},
);

it("ignores future contact and contact from a prior visit, including backdated re-entry", () => {
	const application = app("A", "applied", "2026-10-01", "2026-10-30");
	application.activity.push(
		contact("2026-11-05T12:00:00Z", "2026-10-01"),
		contact("2026-10-25T12:00:00Z", "old-visit"),
	);
	expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: 30 });
	application.activity.push(contact("2026-10-25T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now).kind).toBe("waiting");
	application.activity.push({ ...event("screening", "2026-10-05"), id: "other", writeSequence: 2 });
	application.activity.push({ ...event("applied", "2026-10-10"), id: "re-entry", writeSequence: 3 });
	expect(getNextStep(application, now)).toEqual({ kind: "no-reply", days: 21 });
});

it("dates silence from known contact without inventing an imported stage date", () => {
	const application = app("A", "applied", "2026-10-01", "2026-10-30");
	application.activity[0] = { ...event("applied", "2026-10-01"), dateUnknown: true };
	application.activity.push(contact("2026-10-20T12:00:00Z", "2026-10-01"));
	expect(applicationStageSince(application)).toBeNull();
	expect(getNextStep(application, now)).toEqual({ kind: "no-reply", days: 11 });
});

it("uses the contact instant even before a whole-day stage's noon marker, but not a prior day's contact", () => {
	const application = app("A", "applied", "2026-10-20T12:00:00Z", "2026-10-20T12:00:00Z");
	application.activity.push(contact("2026-10-19T08:00:00Z", "2026-10-20T12:00:00Z"));
	expect(getNextStep(application, new Date("2026-10-30T08:00:00Z"))).toEqual({ kind: "waiting", days: 9 });
	application.activity.push(contact("2026-10-20T08:00:00Z", "2026-10-20T12:00:00Z"));
	expect(getNextStep(application, new Date("2026-10-30T08:00:00Z"))).toEqual({ kind: "no-reply", days: 10 });
});

it.each(["applied", "interview"] as const)(
	"uses the written %s visit for silence after a backdated re-entry",
	(status) => {
		const application = app("A", status, "2026-10-20", "2026-10-30");
		application.activity[0] = { ...event(status, "2026-10-20"), writeSequence: 1 };
		application.activity.push(
			{ ...event("screening", "2026-10-01"), id: "between", writeSequence: 2 },
			{ ...event(status, "2026-10-05"), id: "current-visit", writeSequence: 3 },
		);
		if (status === "interview")
			application.activity.push({
				id: "current-round",
				type: "interview",
				at: new Date("2026-10-06T11:00:00Z"),
				durationMinutes: 60,
				kind: "technical",
				location: "",
				notes: "",
				participants: [],
				audience: "other",
				timezone: "UTC",
			});
		expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: status === "interview" ? 25 : 26 });
		application.activity.push(contact("2026-10-10T12:00:00Z", "current-visit"));
		expect(getNextStep(application, now)).toMatchObject({ kind: "no-reply", days: 21 });
		expect(applicationStageSince(application)).toEqual(new Date("2026-10-20"));
	},
);

it("keeps the latest contact without a function-argument limit on long histories", () => {
	const application = app("A", "applied", "2026-10-01", "2026-10-30");
	const older = contact("2026-10-05T12:00:00Z", "2026-10-01");
	application.activity = [
		...application.activity,
		contact("2026-10-25T12:00:00Z", "2026-10-01"),
		...Array.from({ length: 500_000 }, (_, index) => ({ ...older, id: `old-contact-${index}` })),
	];
	expect(getNextStep(application, now)).toEqual({ kind: "waiting", days: 30 });
});

it("counts interview silence from the later of its end and contact in this visit", () => {
	const application = app("A", "interview", "2026-10-01", "2026-10-30");
	application.activity.push({
		id: "i",
		type: "interview",
		at: new Date("2026-10-15T11:00:00Z"),
		durationMinutes: 60,
		kind: "technical",
	} as ApplicationTimelineEntry);
	application.activity.push(contact("2026-10-10T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now)).toEqual({ kind: "no-reply", days: 16, after: "interview" });
	application.activity.push(contact("2026-10-25T12:00:00Z", "2026-10-01"));
	expect(getNextStep(application, now)).toEqual({ kind: "interview-feedback", days: 30 });
	expect(getNextStep(application, new Date("2026-11-04T12:00:00Z"))).toEqual({
		kind: "no-reply",
		days: 10,
		after: "interview",
	});
	application.activity.push({
		id: "upcoming",
		type: "interview",
		at: new Date("2026-11-02T11:00:00Z"),
		durationMinutes: 60,
		kind: "technical",
	} as ApplicationTimelineEntry);
	expect(getNextStep(application, now)).toMatchObject({ kind: "interview", interview: { id: "upcoming" } });
});
