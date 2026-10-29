import type { ApplicationStatus, ApplicationTimelineEntry } from "./data";
import { describe, expect, it } from "vite-plus/test";
import { hasApplicationSubmission } from "./data";

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
