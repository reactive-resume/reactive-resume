import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { describe, expect, it } from "vite-plus/test";
import { applicationTimelineEntrySchema, hasApplicationSubmission, latestStageEntryId } from "./data";

const stage = (status: ApplicationStatus): Extract<ApplicationTimelineEntry, { type: "stage" }> => ({
	id: status,
	type: "stage",
	stage: status,
	at: new Date("2026-10-29T12:00:00Z"),
});

describe("confirmed application submission", () => {
	it.each(["applied", "screening", "interview", "offer"] as const)(
		"recognizes %s without documents or checklist ticks",
		(status) => {
			expect(hasApplicationSubmission({ status, activity: [] })).toBe(true);
		},
	);
	it("preserves submission after closing, but never infers it from closing a saved job", () => {
		expect(hasApplicationSubmission({ status: "closed", activity: [stage("saved"), stage("closed")] })).toBe(false);
		expect(
			hasApplicationSubmission({ status: "closed", activity: [stage("applied"), stage("interview"), stage("closed")] }),
		).toBe(true);
		expect(
			hasApplicationSubmission({ status: "closed", activity: [{ ...stage("applied"), canonicalTransition: false }] }),
		).toBe(false);
	});
	it("allows a job to return to preparation without treating old history as a new submission", () => {
		expect(hasApplicationSubmission({ status: "saved", activity: [stage("applied"), stage("saved")] })).toBe(false);
	});
});

it("stage-write identity survives date edits, API sorting, legacy dates and same-clock moves", () => {
	const legacy = { ...stage("saved"), at: new Date("2099-01-01T12:00:00Z") };
	const first = { ...stage("applied"), writeSequence: 1 };
	const second = { ...stage("interview"), at: new Date("2026-10-29T08:00:00Z"), writeSequence: 2 };
	for (const entries of [
		[legacy, first, second],
		[second, first, legacy],
	]) {
		expect(latestStageEntryId(entries.map((entry) => applicationTimelineEntrySchema.parse(entry)))).toBe("interview");
	}
	expect(latestStageEntryId([legacy, { ...second, at: new Date("2020-01-01") }])).toBe("interview");
	expect(latestStageEntryId([stage("applied"), legacy])).toBe("saved");
});
