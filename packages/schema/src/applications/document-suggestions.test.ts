import { describe, expect, it } from "vite-plus/test";
import { suggestApplicationDocuments } from "./document-suggestions";

const application = {
	id: "job",
	company: "  Cedar  ",
	status: "saved" as const,
	resumeId: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
};
const resume = {
	id: "resume",
	type: "resume" as const,
	name: "CEDAR — Portfolio",
	isLocked: false,
	trashedAt: null,
	application: null,
};
const letter = { ...resume, id: "letter", type: "letter" as const, name: "Cedar — Introduction" };

describe("company-named document suggestions", () => {
	it("uses the first eligible match of each kind without stealing another job's document", () => {
		const candidates = [
			{ ...resume, id: "unrelated", name: "Orbit — Portfolio" },
			{ ...resume, id: "locked", isLocked: true },
			{ ...resume, id: "trashed", trashedAt: new Date() },
			{ ...resume, id: "other-job", application: { id: "another-job" } },
			resume,
			{ ...resume, id: "older" },
			letter,
		];
		expect(suggestApplicationDocuments(application, candidates)).toEqual([resume, letter]);
		expect(suggestApplicationDocuments(application, [{ ...resume, application: { id: application.id } }])).toHaveLength(
			1,
		);
	});

	it.each([
		{ resumeId: "selected", expected: [letter] },
		{ coverLetterId: "selected", expected: [resume] },
		{ sentResumeVersionId: "sent", expected: [letter] },
		{ sentCoverLetterVersionId: "sent", expected: [resume] },
	])("preserves selected documents and sent-version-bound slots ($expected)", ({ expected, ...patch }) => {
		expect(suggestApplicationDocuments({ ...application, ...patch }, [resume, letter])).toEqual(expected);
	});

	it.each(["offer", "closed"] as const)("does not offer preparation for %s applications", (status) => {
		expect(suggestApplicationDocuments({ ...application, status }, [resume, letter])).toEqual([]);
	});

	it("requires a nonblank literal company name", () => {
		expect(suggestApplicationDocuments({ ...application, company: "  " }, [resume, letter])).toEqual([]);
		expect(suggestApplicationDocuments({ ...application, company: "%" }, [resume, letter])).toEqual([]);
	});
});
