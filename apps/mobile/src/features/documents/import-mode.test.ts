import { needsAIChoice } from "./import-mode";
test("Word cannot silently use a previously approved AI connection after local reading was chosen", () => {
	expect(needsAIChoice("resume.DOCX", false)).toBe(true);
	expect(needsAIChoice("resume.docx", true)).toBe(false);
	expect(needsAIChoice("resume.pdf", false)).toBe(false);
});
