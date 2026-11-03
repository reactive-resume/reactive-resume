import type { ApplicationTimelineEntry, InterviewTimelineEntry } from "./data";
import { expect, it } from "vite-plus/test";
import { latestOfferHints } from "./next-step";
import { upcomingApplicationEvents } from "./upcoming";

const now = new Date("2030-01-03T10:00:00Z");
const interview: InterviewTimelineEntry = {
	id: "round",
	type: "interview",
	at: now,
	kind: "technical",
	durationMinutes: 60,
	timezone: "UTC",
	participants: [],
	audience: "other",
	location: "",
	notes: "",
};
const application = {
	id: "offer-job",
	status: "offer" as const,
	activity: [interview] as ApplicationTimelineEntry[],
	followUpAt: "2030-01-03T11:00:00Z",
	followUpDateOnly: false,
	followUpNote: "Email Maya",
};

it("reads the newest saved offer even when its explicit null clears an older reply deadline", () => {
	const hints = latestOfferHints([
		{ applicationId: application.id, createdAt: "2030-01-02", data: { kind: "offer", respondBy: null } },
		{
			applicationId: application.id,
			createdAt: "2030-01-01",
			data: { kind: "offer", respondBy: "2030-01-04T12:00:00Z" },
		},
		{ applicationId: application.id, createdAt: "2030-01-03", data: { kind: "briefing" } },
		{ applicationId: null, createdAt: "2030-01-04", data: { kind: "offer", respondBy: "2030-01-05T12:00:00Z" } },
	]);
	expect(hints.get(application.id)).toMatchObject({ respondBy: null });
	expect(hints.size).toBe(1);
});

it("keeps simultaneous interview, follow-up and latest offer dates rather than only Next step", () => {
	const offers = new Map([[application.id, { respondBy: "2030-01-03T12:00:00Z" }]]);
	expect(
		upcomingApplicationEvents([application], offers, now, "UTC").map(({ kind, at }) => [kind, at.toISOString()]),
	).toEqual([
		["interview", "2030-01-03T10:00:00.000Z"],
		["follow-up", "2030-01-03T11:00:00.000Z"],
		["offer", "2030-01-03T12:00:00.000Z"],
	]);
	expect(
		upcomingApplicationEvents([application], new Map([[application.id, { respondBy: null }]]), now, "UTC").map(
			(row) => row.kind,
		),
	).toEqual(["interview", "follow-up"]);
	expect(upcomingApplicationEvents([application], undefined, now, "UTC").map((row) => row.kind)).toEqual([
		"interview",
		"follow-up",
	]);
});

it("uses account-clock date-only follow-ups, exact midnight instants, stable ties and ongoing interviews", () => {
	const day = { ...application, activity: [], followUpAt: "2030-01-03T00:00:00Z", followUpDateOnly: true };
	expect(upcomingApplicationEvents([day], undefined, now, "Pacific/Honolulu")[0]?.at).toEqual(
		new Date("2030-01-03T19:00:00Z"),
	);
	expect(upcomingApplicationEvents([{ ...day, followUpDateOnly: false }], undefined, now, "Pacific/Honolulu")).toEqual(
		[],
	);
	const ongoing = {
		...application,
		activity: [{ ...interview, at: new Date("2030-01-03T09:30:00Z") }],
		followUpAt: null,
	};
	expect(upcomingApplicationEvents([ongoing], undefined, now, "UTC")).toHaveLength(1);
	expect(
		upcomingApplicationEvents(
			[{ ...ongoing, activity: [{ ...interview, at: new Date("2030-01-03T08:59:00Z") }] }],
			undefined,
			now,
			"UTC",
		),
	).toEqual([]);
	const tied = ["b", "a"].map((id) => ({ ...application, id, activity: [] }));
	expect(upcomingApplicationEvents(tied, undefined, now, "UTC").map((row) => row.application.id)).toEqual(["a", "b"]);
});

it("excludes closed applications, overdue deadlines and retired offer-stage deadlines", () => {
	const offers = new Map([[application.id, { respondBy: "2030-01-03T09:00:00Z" }]]);
	expect(upcomingApplicationEvents([{ ...application, status: "closed" }], offers, now, "UTC")).toEqual([]);
	expect(
		upcomingApplicationEvents(
			[{ ...application, activity: [], followUpAt: "2030-01-02T09:00:00Z" }],
			offers,
			now,
			"UTC",
		),
	).toEqual([]);
	expect(
		upcomingApplicationEvents(
			[{ ...application, status: "applied", activity: [], followUpAt: null }],
			new Map([[application.id, { respondBy: "2030-01-04T09:00:00Z" }]]),
			now,
			"UTC",
		),
	).toEqual([]);
});
