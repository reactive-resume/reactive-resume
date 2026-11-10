jest.mock("@reactive-resume/utils/string", () => ({ escapeHtml: (text: string) => text, generateId: () => "fixture" }));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: () => null, setItemSync: jest.fn(), removeItemSync: jest.fn(), getAllKeysSync: () => [] },
}));
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { storyboardPdfCheck } from "./ats-fixture";
import { seed, fakeBackend, isBusy } from "./fixtures";
test("storyboard and empty-account share real resource shapes and exact displayed identities", async () => {
	seed("storyboard");
	const documents = await fakeBackend.read("documents", {});
	expect(documents.map((row) => row.name)).toEqual([
		"Product designer",
		"Product designer — Lumen",
		"Design lead",
		"Letter for Lumen",
		"Letter for Orbital Health",
	]);
	const resume = await fakeBackend.read("resume", { id: "resume-product" });
	expect(resumeDataSchema.parse(resume.data).basics.name).toBe("Alex Morgan");
	expect(coverLetterSchema.parse(await fakeBackend.read("letter", { id: "letter-0" })).recipientCompany).toBe("Lumen");
	expect(await fakeBackend.read("documents", { trashed: true })).toHaveLength(2);
	expect(isBusy()).toBe(false);
	const check = storyboardPdfCheck("resume.pdf", "");
	expect(check.fullText).toContain("Alex Morgan");
	expect(check.report.file.name).toBe("resume.pdf");
	expect(check.report.document.wordCount).toBeGreaterThan(0);
	seed("empty-account");
	expect(await fakeBackend.read("documents", {})).toEqual([]);
	expect(await fakeBackend.read("applications", {})).toEqual([]);
});
