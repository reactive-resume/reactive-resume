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

it("keeps a follow-up on the calendar date selected in its browser-local editor", () => {
	const at = new Date(2026, 9, 30, 9);
	const step = getNextStep(application({ followUpAt: at }), NOW);
	const expected = at.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short" });
	for (const timeZone of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
		expect(describeNextStep(step, { status: "applied", closedReason: null }, "en-GB", timeZone).sub).toBe(expected);
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
		expect(getNextStep(atOffer(), NOW, null)).toEqual({ kind: "offer", respondBy: null, overdue: false, terms: false });
	});

	it("leads with the reply deadline of the saved offer", () => {
		const respondBy = day(3).toISOString();
		expect(getNextStep(atOffer(), NOW, { respondBy })).toEqual({
			kind: "offer",
			respondBy: new Date(respondBy),
			overdue: false,
			terms: true,
		});
		const late = getNextStep(atOffer(), NOW, { respondBy: day(-1).toISOString() });
		expect(late).toMatchObject({ kind: "offer", overdue: true });
	});

	it("reads as a decision when terms are saved without a deadline, or not known yet", () => {
		const text = (offer?: { respondBy: string | null } | null) =>
			describeNextStep(getNextStep(atOffer(), NOW, offer), { status: "offer", closedReason: null }, "en-US", "UTC");
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

		expect(getNextStep(withFollowUp, NOW, null)).toEqual({
			kind: "follow-up",
			at: new Date(followUpAt),
			note: "Ask about the start date",
			overdue: false,
		});
		expect(getNextStep(withFollowUp, NOW, { respondBy: day(3).toISOString() })).toMatchObject({ kind: "offer" });
	});

	it("leaves earlier stages as they were", () => {
		const step = getNextStep(application({ status: "interview", activity: [interview(day(2))] }), NOW, null);
		expect(step).toMatchObject({ kind: "interview" });
	});
});
