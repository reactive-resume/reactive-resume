import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { compareResumeRecovery } from "./compare-resume";

const SYNTHETIC_SOURCE_HASH = "0600d56212904d5aa7179f8dfb520383cb2cb50494a95f5e1cd410d6d7793ea0";
const RECOVERED_COPY_HASH = "25ec4affb3dfd85d50f01a0a2749790e1588091e58b4d900051824863f787420";
const CURRENT_COPY_HASH = "1c5639bbd2d78fd5ca1b3eadd9e5f507b856b9cc65f0ea120f22434b4c988518";

type RecoveryRequest = {
	caseId: unknown;
	sourceResumeId: unknown;
	targetResumeId: unknown;
	ownerVerified: unknown;
	ownerMappingPresent: unknown;
	sourceAvailable: unknown;
	source: unknown;
	target: unknown;
};

function resumeWithName(name: string) {
	const resume = structuredClone(defaultResumeData);
	resume.basics.name = name;
	return resume;
}

function validRequestObject(overrides: Partial<RecoveryRequest> = {}): RecoveryRequest {
	return {
		caseId: "case-synthetic-001",
		sourceResumeId: "resume-v4-synthetic-001",
		targetResumeId: "resume-v5-synthetic-001",
		ownerVerified: true,
		ownerMappingPresent: true,
		sourceAvailable: true,
		source: resumeWithName("Synthetic source"),
		target: resumeWithName("Synthetic source"),
		...overrides,
	};
}

function validRequest(overrides: Partial<RecoveryRequest> = {}): string {
	return JSON.stringify(validRequestObject(overrides));
}

describe("compareResumeRecovery", () => {
	it("returns no-op with hand-checked hashes when serialized source and target are identical", () => {
		expect(compareResumeRecovery(validRequest())).toEqual({
			caseId: "case-synthetic-001",
			sourceResumeId: "resume-v4-synthetic-001",
			targetResumeId: "resume-v5-synthetic-001",
			sourceHash: SYNTHETIC_SOURCE_HASH,
			targetHash: SYNTHETIC_SOURCE_HASH,
			outcome: "no-op",
			blockedReason: null,
		});
	});

	it("returns export-copy when serialized request has no target resume", () => {
		expect(compareResumeRecovery(validRequest({ targetResumeId: null, target: null }))).toEqual({
			caseId: "case-synthetic-001",
			sourceResumeId: "resume-v4-synthetic-001",
			targetResumeId: null,
			sourceHash: SYNTHETIC_SOURCE_HASH,
			targetHash: null,
			outcome: "export-copy",
			blockedReason: null,
		});
	});

	it("returns export-copy with both hashes when serialized source and target diverge", () => {
		expect(
			compareResumeRecovery(
				validRequest({ source: resumeWithName("Recovered copy"), target: resumeWithName("Current copy") }),
			),
		).toEqual({
			caseId: "case-synthetic-001",
			sourceResumeId: "resume-v4-synthetic-001",
			targetResumeId: "resume-v5-synthetic-001",
			sourceHash: RECOVERED_COPY_HASH,
			targetHash: CURRENT_COPY_HASH,
			outcome: "export-copy",
			blockedReason: null,
		});
	});

	it.each([
		[{ ownerVerified: false }, "owner-unverified"],
		[{ ownerMappingPresent: false }, "owner-mapping-missing"],
	] as const)("blocks before hashing when serialized identity gate fails with %s", (overrides, blockedReason) => {
		expect(compareResumeRecovery(validRequest(overrides))).toMatchObject({
			sourceHash: null,
			targetHash: null,
			outcome: "blocked",
			blockedReason,
		});
	});

	it("blocks when serialized request says source snapshot is unavailable", () => {
		expect(compareResumeRecovery(validRequest({ sourceAvailable: false, source: null }))).toMatchObject({
			sourceHash: null,
			targetHash: null,
			outcome: "blocked",
			blockedReason: "source-unavailable",
		});
	});

	it("blocks malformed source data instead of treating it as an empty resume", () => {
		expect(compareResumeRecovery(validRequest({ source: "{" }))).toMatchObject({
			sourceHash: null,
			targetHash: null,
			outcome: "blocked",
			blockedReason: "invalid-source-json",
		});
	});

	it("blocks malformed target data instead of replacing it", () => {
		expect(compareResumeRecovery(validRequest({ target: "{" }))).toMatchObject({
			sourceHash: SYNTHETIC_SOURCE_HASH,
			targetHash: null,
			outcome: "blocked",
			blockedReason: "invalid-target-json",
		});
	});

	it.each([
		[{ targetResumeId: null }, null],
		[{ target: null }, "resume-v5-synthetic-001"],
	] as const)("blocks contradictory serialized target presence for %s", (overrides, targetResumeId) => {
		expect(compareResumeRecovery(validRequest(overrides))).toEqual({
			caseId: "case-synthetic-001",
			sourceResumeId: "resume-v4-synthetic-001",
			targetResumeId,
			sourceHash: null,
			targetHash: null,
			outcome: "blocked",
			blockedReason: "target-presence-mismatch",
		});
	});
});
