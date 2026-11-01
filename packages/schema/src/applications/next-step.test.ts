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
