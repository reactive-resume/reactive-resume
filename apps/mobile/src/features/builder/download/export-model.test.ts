jest.mock("uuid", () => ({ validate: () => false, v5: () => "test-id", v7: () => "test-id" }));
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { coverLetterSchema, coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { letterBackup } from "./export-model";

test("letter backup round trips content and design without account or source identifiers", () => {
	const letter = coverLetterSchema.parse({
		id: "private-id",
		name: "Letter",
		recipient: "Team",
		content: "<p>My words</p>",
		style: copyCoverLetterStyle(defaultResumeData),
		sourceResumeId: "private-resume",
		sourceApplicationId: "private-application",
		senderLinked: true,
		designLinked: true,
		isLocked: false,
		revision: 1,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const backup = letterBackup(letter);
	expect(coverLetterDocumentSchema.parse(backup).content).toBe(letter.content);
	expect(backup).not.toHaveProperty("sourceResumeId");
	expect(backup).not.toHaveProperty("id");
	expect(backup.style).toEqual(letter.style);
});
