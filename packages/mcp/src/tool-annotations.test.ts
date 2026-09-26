import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAME } from "./mcp-tool-names";
import { TOOL_META } from "./tool-meta";

describe("MCP_TOOL_NAME", () => {
	it("uses canonical unprefixed snake_case tool names", () => {
		for (const name of Object.values(MCP_TOOL_NAME)) {
			expect(name).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
			expect(name.split("_").at(0)).not.toBe("reactive");
		}
	});

	it("uses the canonical read and patch names", () => {
		expect(MCP_TOOL_NAME.getResume).toBe("read_resume");
		expect(MCP_TOOL_NAME.patchResume).toBe("apply_resume_patch");
	});

	it("uses canonical application tool names", () => {
		expect(MCP_TOOL_NAME.listApplications).toBe("list_applications");
		expect(MCP_TOOL_NAME.readApplication).toBe("read_application");
		expect(MCP_TOOL_NAME.createApplication).toBe("create_application");
		expect(MCP_TOOL_NAME.attachApplicationDocument).toBe("attach_application_document");
		expect(MCP_TOOL_NAME.autofillApplicationFromJob).toBe("autofill_application_from_job");
	});

	it("uses unique values for every tool", () => {
		const values = Object.values(MCP_TOOL_NAME);
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("tool annotations", () => {
	it("provides explicit submission hints for every registered tool", () => {
		for (const name of Object.values(MCP_TOOL_NAME)) {
			const annotations = TOOL_META[name].annotations;
			expect(typeof annotations.readOnlyHint, name).toBe("boolean");
			expect(typeof annotations.destructiveHint, name).toBe("boolean");
			expect(typeof annotations.openWorldHint, name).toBe("boolean");
		}
	});

	it("marks list/get tools as readOnly + idempotent + non-destructive", () => {
		const readOnlyTools = [
			MCP_TOOL_NAME.listResumes,
			MCP_TOOL_NAME.listResumeTags,
			MCP_TOOL_NAME.getResume,
			MCP_TOOL_NAME.getResumeStatistics,
			MCP_TOOL_NAME.listApplications,
			MCP_TOOL_NAME.readApplication,
			MCP_TOOL_NAME.listApplicationTags,
			MCP_TOOL_NAME.getApplicationStats,
			MCP_TOOL_NAME.listCoverLetters,
			MCP_TOOL_NAME.readCoverLetter,
			MCP_TOOL_NAME.exportCoverLetter,
		];
		for (const name of readOnlyTools) {
			const annotations = TOOL_META[name].annotations;
			expect(annotations.readOnlyHint, name).toBe(true);
			expect(annotations.destructiveHint, name).toBe(false);
			expect(annotations.idempotentHint, name).toBe(true);
		}
	});

	it("marks PDF download URL generation as read-only but non-idempotent", () => {
		const annotations = TOOL_META[MCP_TOOL_NAME.downloadResumePdf].annotations;
		expect(annotations.readOnlyHint).toBe(true);
		expect(annotations.idempotentHint).toBe(false);
		expect(annotations.destructiveHint).toBe(false);
	});

	it("marks deleteResume as destructive (but still idempotent)", () => {
		const annotations = TOOL_META[MCP_TOOL_NAME.deleteResume].annotations;
		expect(annotations.destructiveHint).toBe(true);
		expect(annotations.idempotentHint).toBe(true);
		expect(annotations.readOnlyHint).toBe(false);
	});

	it("marks application delete tools as destructive", () => {
		for (const name of [MCP_TOOL_NAME.deleteApplication, MCP_TOOL_NAME.bulkDeleteApplications]) {
			const annotations = TOOL_META[name].annotations;
			expect(annotations.readOnlyHint, name).toBe(false);
			expect(annotations.destructiveHint, name).toBe(true);
		}
	});

	it("marks creation/import/duplicate as non-readonly and non-idempotent", () => {
		for (const name of [
			MCP_TOOL_NAME.createResume,
			MCP_TOOL_NAME.importResume,
			MCP_TOOL_NAME.duplicateResume,
			MCP_TOOL_NAME.createApplication,
			MCP_TOOL_NAME.importApplications,
			MCP_TOOL_NAME.addApplicationInterview,
			MCP_TOOL_NAME.draftApplicationMessage,
			MCP_TOOL_NAME.createCoverLetter,
			MCP_TOOL_NAME.duplicateCoverLetter,
			MCP_TOOL_NAME.copyEmbeddedCoverLetter,
			MCP_TOOL_NAME.importCoverLetter,
		]) {
			const annotations = TOOL_META[name].annotations;
			expect(annotations.readOnlyHint, name).toBe(false);
			expect(annotations.idempotentHint, name).toBe(false);
			expect(annotations.destructiveHint, name).toBe(false);
		}
	});

	it("marks lockResume / unlockResume as idempotent and non-destructive", () => {
		for (const name of [MCP_TOOL_NAME.lockResume, MCP_TOOL_NAME.unlockResume]) {
			const annotations = TOOL_META[name].annotations;
			expect(annotations.idempotentHint, name).toBe(true);
			expect(annotations.destructiveHint, name).toBe(false);
			expect(annotations.readOnlyHint, name).toBe(false);
		}
	});

	it("marks tools that replace or remove existing data as destructive", () => {
		for (const name of [
			MCP_TOOL_NAME.patchResume,
			MCP_TOOL_NAME.updateResume,
			MCP_TOOL_NAME.updateApplication,
			MCP_TOOL_NAME.updateApplicationTimelineEntry,
			MCP_TOOL_NAME.updateApplicationInterview,
			MCP_TOOL_NAME.bulkUpdateApplications,
			MCP_TOOL_NAME.attachApplicationDocument,
			MCP_TOOL_NAME.removeApplicationDocument,
			MCP_TOOL_NAME.scoreApplicationMatch,
			MCP_TOOL_NAME.tailorResumeForApplication,
			MCP_TOOL_NAME.updateCoverLetter,
			MCP_TOOL_NAME.refreshCoverLetterStyle,
			MCP_TOOL_NAME.deleteCoverLetter,
		]) {
			expect(TOOL_META[name].annotations.readOnlyHint, name).toBe(false);
			expect(TOOL_META[name].annotations.destructiveHint, name).toBe(true);
		}
	});

	it("marks public content changes and external AI calls as open-world", () => {
		const openWorldTools = new Set<string>([
			MCP_TOOL_NAME.patchResume,
			MCP_TOOL_NAME.updateResume,
			MCP_TOOL_NAME.deleteResume,
			MCP_TOOL_NAME.attachApplicationDocument,
			MCP_TOOL_NAME.removeApplicationDocument,
			MCP_TOOL_NAME.deleteApplication,
			MCP_TOOL_NAME.bulkDeleteApplications,
			MCP_TOOL_NAME.deleteCoverLetter,
			MCP_TOOL_NAME.autofillApplicationFromJob,
			MCP_TOOL_NAME.scoreApplicationMatch,
			MCP_TOOL_NAME.tailorResumeForApplication,
			MCP_TOOL_NAME.draftApplicationMessage,
		]);
		for (const [name, { annotations }] of Object.entries(TOOL_META)) {
			expect(annotations.openWorldHint, name).toBe(openWorldTools.has(name));
		}
	});
});
