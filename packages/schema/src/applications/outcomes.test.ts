import { describe, expect, it } from "vite-plus/test";
import { applicationSentAt, computeOutcomes } from "./outcomes";

const day = (value: number) => new Date(Date.UTC(2026, 8, value, 12));
const stage = (value: "applied" | "interview" | "offer", at: number, dateUnknown = false) => ({
	id: `${value}-${at}`,
	type: "stage" as const,
	stage: value,
	at: day(at),
	dateUnknown,
});
const source = { status: "offer" as const, closedReason: null, resumeId: null, appliedAt: day(1) };

describe("recorded application timing", () => {
	it("does not use one later-stage timestamp as both submission and reply", () => {
		const application = { ...source, activity: [stage("offer", 1)] };
		expect(applicationSentAt(application)).toBeUndefined();
		expect(computeOutcomes([application], () => false)).toMatchObject({
			sent: 1,
			heardBack: 1,
			medianDaysToReply: null,
		});
	});
	it("excludes unknown imported dates while retaining real same-day replies", () => {
		const unknown = { ...source, activity: [stage("applied", 1), stage("offer", 8, true)] };
		const sameDay = { ...source, activity: [stage("applied", 1), stage("offer", 1)] };
		expect(computeOutcomes([unknown], () => false)).toMatchObject({ sent: 1, heardBack: 1, medianDaysToReply: null });
		expect(computeOutcomes([unknown, sameDay], () => false)).toMatchObject({
			sent: 2,
			heardBack: 2,
			medianDaysToReply: 0,
		});
		const progressed = { ...source, activity: [stage("applied", 1), stage("interview", 20, true), stage("offer", 8)] };
		expect(computeOutcomes([progressed], () => false).medianDaysToReply).toBeNull();
	});
});
