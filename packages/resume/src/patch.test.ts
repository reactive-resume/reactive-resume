import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { applyResumePatches, describeResumePatchError, ResumePatchError } from "./patch";

describe("applyResumePatches", () => {
	it("applies multiple ops in sequence", () => {
		const result = applyResumePatches(defaultResumeData, [
			{ op: "replace", path: "/basics/name", value: "Alice" },
			{ op: "replace", path: "/basics/email", value: "alice@example.com" },
		]);

		expect(result.basics.name).toBe("Alice");
		expect(result.basics.email).toBe("alice@example.com");
	});

	it("stops copies before they grow the resume past its size limit", () => {
		// Each copy doubles the document; forty of them would need terabytes.
		const operations = Array.from({ length: 40 }, (_, index) => ({
			op: "copy" as const,
			from: "",
			path: `/copy${index}`,
		}));
		expect(() => applyResumePatches(defaultResumeData, operations)).toThrow(
			expect.objectContaining({ code: "PATCH_TOO_LARGE" }),
		);
	});

	it("reports a copy from a missing path as OPERATION_FROM_UNRESOLVABLE", () => {
		expect(() =>
			applyResumePatches(defaultResumeData, [{ op: "copy", from: "/missing/nested", path: "/basics/name" }]),
		).toThrow(expect.objectContaining({ code: "OPERATION_FROM_UNRESOLVABLE", index: 0 }));
	});

	it("throws ResumePatchError for unresolvable path", () => {
		expect(() =>
			applyResumePatches(defaultResumeData, [{ op: "replace", path: "/does/not/exist", value: "x" }]),
		).toThrow(ResumePatchError);
	});

	it("names the failing operation and path", () => {
		let caught: unknown;
		try {
			applyResumePatches(defaultResumeData, [{ op: "replace", path: "/basics/nope/x", value: "y" }]);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(ResumePatchError);
		expect(describeResumePatchError(caught as ResumePatchError)).toMatch(
			/^The replace operation at \/basics\/nope\/x failed: /,
		);
	});

	it("throws ResumePatchError for failed test op", () => {
		try {
			applyResumePatches(defaultResumeData, [{ op: "test", path: "/basics/name", value: "wrong-value" }]);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ResumePatchError);
			const patchError = error as ResumePatchError;
			expect(patchError.code).toBe("TEST_OPERATION_FAILED");
			expect(patchError.index).toBe(0);
			expect(patchError.message).toContain("Test operation failed");
			expect(patchError.operation).toEqual({ op: "test", path: "/basics/name", value: "wrong-value" });
		}
	});

	it("rolls back if patched document fails schema validation", () => {
		// The tolerant read-time parser would silently replace an unknown template with "onyx";
		// a write must reject it instead (#3413).
		expect(() =>
			applyResumePatches(defaultResumeData, [{ op: "replace", path: "/metadata/template", value: "unknown-template" }]),
		).toThrow(/Patch produced invalid resume data/);
	});
});
