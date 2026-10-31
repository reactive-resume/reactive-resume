import type { Application } from "./types";
import { describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";

i18n.load("en", {});
i18n.activate("en");
import { daysInLane, describeNextStep, getNextStep } from "./next-step";

const NOW = new Date("2026-09-28T12:00:00Z");
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);

type Source = Parameters<typeof getNextStep>[0];

const application = (patch: Partial<Source> = {}): Source => ({
	status: "applied",
	activity: [{ id: "s1", type: "stage", stage: "applied", at: day(-3) }],
	followUpAt: null,
	followUpNote: null,
	appliedAt: day(-3),
	...patch,
});

const interview = (at: Date, id = "i1"): Application["activity"][number] => ({
	id,
	type: "interview",
	at,
	kind: "onsite",
	durationMinutes: 60,
	location: "",
	notes: "",
	participants: [],
	audience: "other",
	timezone: "UTC",
});

describe("getNextStep", () => {
	it("puts the earliest interview still to come first", () => {
		const step = getNextStep(
			application({
				status: "interview",
				followUpAt: day(1),
				activity: [interview(day(-2), "past"), interview(day(5), "later"), interview(day(2), "soon")],
			}),
			NOW,
		);
		expect(step).toMatchObject({ kind: "interview", interview: { id: "soon" } });
	});

	it("suggests a follow-up after ten days without a reply, and counts the wait before that", () => {
		expect(getNextStep(application(), NOW)).toEqual({ kind: "waiting", days: 3 });
		const quiet = application({ activity: [{ id: "s1", type: "stage", stage: "applied", at: day(-12) }] });
		expect(getNextStep(quiet, NOW)).toEqual({ kind: "no-reply", days: 12 });
	});

	it("keeps the no-reply clock running across a move between two Applied lanes, while time in lane restarts", () => {
		const moved = {
			...application({
				activity: [
					{ id: "s1", type: "stage", stage: "applied", laneId: "applied", at: day(-12) },
					{ id: "s2", type: "stage", stage: "applied", laneId: "chased", canonicalTransition: false, at: day(-2) },
				],
			}),
			laneId: "chased",
		};
		expect(getNextStep(moved, NOW)).toEqual({ kind: "no-reply", days: 12 });
		expect(daysInLane(moved, NOW)).toBe(2);
	});
});

it.each([
	["UTC", "09:00"],
	["Europe/Berlin", "10:00"],
])("describes interviews on the %s account clock", (timeZone, time) => {
	const source = application({ activity: [interview(new Date("2026-10-30T09:00:00Z"))] });
	const step = getNextStep(source, NOW);
	const text = describeNextStep(step, { status: "interview", closedReason: null }, "en-GB", timeZone);
	expect(text.sub).toContain(time);
	expect(source.activity[0]?.at).toEqual(new Date("2026-10-30T09:00:00Z"));
});

it("shows a follow-up on the same account date as its Today reminder", () => {
	const step = getNextStep(application({ followUpAt: new Date("2026-10-30T09:00:00Z") }), NOW);
	for (const [timeZone, expected] of [
		["Pacific/Honolulu", "Thu 29 Oct"],
		["Pacific/Kiritimati", "Fri 30 Oct"],
	] as const) {
		expect(describeNextStep(step, { status: "applied", closedReason: null }, "en-GB", timeZone)).toMatchObject({
			sub: expected,
		});
	}
});

it("resolves a legacy selected day at 09:00 while an explicit midnight remains exact", () => {
	const source = application({ followUpAt: new Date("2030-01-03T00:00:00Z"), followUpDateOnly: true });
	const legacy = getNextStep(source, new Date("2030-01-03T12:00:00Z"), "Pacific/Honolulu");
	expect(legacy).toMatchObject({ kind: "follow-up", at: new Date("2030-01-03T19:00:00Z"), overdue: false });
	expect(describeNextStep(legacy, { status: "applied", closedReason: null }, "en-GB", "Pacific/Honolulu").sub).toBe(
		"Thu 3 Jan",
	);
	expect(
		getNextStep({ ...source, followUpDateOnly: false }, new Date("2030-01-03T12:00:00Z"), "Pacific/Honolulu"),
	).toMatchObject({ kind: "follow-up", at: source.followUpAt, overdue: true });
});
