import type { Application } from "./types";
import { describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";

i18n.load("en", {});
i18n.activate("en");
import { daysInLane, describeNextStep, getNextStep, needsAttention } from "./next-step";

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

	it.each([
		["interview", [interview(day(-2))], "Waiting for interview feedback"],
		["interview", [], "No interview scheduled"],
		["offer", [], "Decide on the offer"],
		["screening", [], "Waiting to hear back"],
	] as const)("tells a %s-stage application what it is actually waiting on", (status, interviews, title) => {
		const source = application({
			status,
			activity: [{ id: "s", type: "stage", stage: status, at: day(-4) }, ...interviews],
		});
		const text = describeNextStep(getNextStep(source, NOW), { status, closedReason: null }, "en-GB", "UTC");
		expect(text.title).toBe(title);
		expect(text.sub).toBe(
			status === "offer"
				? "Compare it with your other offers"
				: title === "No interview scheduled"
					? "Add the date when you have it"
					: "For 4 days",
		);
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

describe("Next step at the Offer stage (J2-17)", () => {
	const atOffer = (patch: Partial<Source> = {}) =>
		application({
			status: "offer",
			activity: [
				{ id: "s1", type: "stage", stage: "applied", at: day(-20) },
				{ id: "s2", type: "stage", stage: "offer", at: day(-1) },
				interview(day(5), "earlier-round"),
			],
			...patch,
		});

	it("asks for the offer's terms instead of an interview booked before the offer", () => {
		expect(getNextStep(atOffer(), NOW, "UTC", null)).toEqual({
			kind: "offer",
			days: 1,
			respondBy: null,
			overdue: false,
			terms: false,
		});
	});

	it("leads with the reply deadline of the saved offer", () => {
		const respondBy = day(3).toISOString();
		expect(getNextStep(atOffer(), NOW, "UTC", { respondBy })).toEqual({
			kind: "offer",
			days: 1,
			respondBy: new Date(respondBy),
			overdue: false,
			terms: true,
		});
		const late = getNextStep(atOffer(), NOW, "UTC", { respondBy: day(-1).toISOString() });
		expect(late).toMatchObject({ kind: "offer", overdue: true });
	});

	it("reads as a decision when terms are saved without a deadline, or not known yet", () => {
		const text = (offer?: { respondBy: string | null } | null) =>
			describeNextStep(
				getNextStep(atOffer(), NOW, "UTC", offer),
				{ status: "offer", closedReason: null },
				"en-US",
				"UTC",
			);
		expect(text(null).title).toBe("Add the offer's terms");
		expect(text({ respondBy: null }).title).toBe("Decide on the offer");
		expect(text().title).toBe("Decide on the offer");
		expect(text({ respondBy: day(3).toISOString() })).toMatchObject({ title: "Reply to the offer", tone: "normal" });
		expect(text({ respondBy: day(-1).toISOString() })).toMatchObject({ title: "Reply to the offer", tone: "warn" });
	});

	it("puts a follow-up set at Offer ahead of an interview booked before it, but after the reply deadline", () => {
		const followUpAt = day(2);
		const withFollowUp = atOffer({
			followUpAt,
			followUpNote: "Ask about the start date",
			activity: [interview(day(1))],
		});

		expect(getNextStep(withFollowUp, NOW, "UTC", null)).toEqual({
			kind: "follow-up",
			at: new Date(followUpAt),
			note: "Ask about the start date",
			overdue: false,
		});
		expect(getNextStep(withFollowUp, NOW, "UTC", { respondBy: day(3).toISOString() })).toMatchObject({ kind: "offer" });
	});

	it("leaves earlier stages as they were", () => {
		const step = getNextStep(application({ status: "interview", activity: [interview(day(2))] }), NOW, "UTC", null);
		expect(step).toMatchObject({ kind: "interview" });
	});
});

it.each([
	["an interview within a week", { activity: [interview(day(6))] }, true],
	["an interview further out", { activity: [interview(day(9))] }, false],
	["a follow-up due tomorrow", { followUpAt: day(0.5) }, true],
	["an overdue follow-up", { followUpAt: day(-1) }, true],
	["a follow-up next week", { followUpAt: day(7) }, false],
	["no reply after twelve days", { activity: [{ id: "s", type: "stage", stage: "applied", at: day(-12) }] }, true],
	["a recent application", {}, false],
	[
		"an offer to decide",
		{ status: "offer", activity: [{ id: "s", type: "stage", stage: "offer", at: day(-1) }] },
		true,
	],
	["a saved job", { status: "saved" }, false],
	["a closed application", { status: "closed" }, false],
] as const)("decides whether %s needs the user", (_, patch, expected) => {
	expect(needsAttention(getNextStep(application(patch as Partial<Source>), NOW), NOW)).toBe(expected);
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
