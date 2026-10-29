import type { StageCount } from "./insights";
import { describe, expect, it } from "vite-plus/test";
import { computeInsights, computeOutcomes, computeTimeline } from "./insights";

describe("computeOutcomes", () => {
	const at = (day: number) => new Date(Date.UTC(2026, 8, day, 12));
	const stage = (stage: StageCount["status"], day: number) => ({
		id: `${stage}${day}`,
		type: "stage" as const,
		stage,
		at: at(day),
	});

	const applications = [
		// Sent on the 1st, heard back (screening) on the 5th, then turned down.
		{
			status: "closed" as const,
			closedReason: "not-selected" as const,
			resumeId: "tailored",
			appliedAt: at(1),
			activity: [stage("applied", 1), stage("screening", 5), stage("closed", 9)],
		},
		// Sent on the 2nd, interview on the 12th.
		{
			status: "interview" as const,
			closedReason: null,
			resumeId: "base",
			appliedAt: at(2),
			activity: [stage("saved", 1), stage("applied", 2), stage("interview", 12)],
		},
		// Sent, no reply yet.
		{
			status: "applied" as const,
			closedReason: null,
			resumeId: "base",
			appliedAt: at(3),
			activity: [stage("applied", 3)],
		},
		// Never sent.
		{ status: "saved" as const, closedReason: null, resumeId: null, appliedAt: at(4), activity: [stage("saved", 4)] },
	];

	const outcomes = computeOutcomes(applications, (application) => application.resumeId === "tailored");

	it("counts every application that reached each stage, closed ones included", () => {
		expect(outcomes.funnel).toEqual([
			{ status: "applied", reached: 3 },
			{ status: "screening", reached: 2 },
			{ status: "interview", reached: 1 },
			{ status: "offer", reached: 0 },
		]);
	});

	it("measures replies and the median days to the first one", () => {
		expect(outcomes.sent).toBe(3);
		expect(outcomes.heardBack).toBe(2);
		expect(outcomes.medianDaysToReply).toBe(7); // 4 and 10 days
	});

	it("counts sent applications in weekly activity after closing, excluding never-sent jobs", () => {
		const now = new Date();
		const current = applications.map((application) => ({
			...application,
			appliedAt: now,
			activity: application.activity.map((entry) => ({ ...entry, at: now })),
		}));
		expect(computeTimeline(current, 1)[0]?.count).toBe(3);
	});
});

it("labels the pipeline total and percentages using active applications", () => {
	const insights = computeInsights([
		{ status: "saved", count: 1 },
		{ status: "applied", count: 2 },
		{ status: "closed", count: 4 },
	]);
	expect(insights.total).toBe(3);
	expect(insights.closed).toBe(4);
	expect(insights.funnel[0]?.pct).toBe(100);
});

it.each(["closed", "applied"] as const)(
	"uses recorded rejection dates after outcome changes and %s state",
	(status) => {
		const at = (day: number) => new Date(Date.UTC(2026, 0, day, 12));
		const application = {
			status,
			closedReason: status === "closed" ? ("not-selected" as const) : null,
			resumeId: null,
			appliedAt: at(1),
			activity: [
				{ id: "sent", type: "stage" as const, stage: "applied" as const, at: at(1) },
				{
					id: "ghosted",
					type: "stage" as const,
					stage: "closed" as const,
					at: at(5),
					closedReason: "no-response" as const,
				},
				{
					id: "reply",
					type: "stage" as const,
					stage: "closed" as const,
					at: at(10),
					closedReason: "not-selected" as const,
					canonicalTransition: false,
				},
			],
		};
		expect(computeOutcomes([application], () => false)).toMatchObject({ sent: 1, heardBack: 1, medianDaysToReply: 9 });
	},
);
