import type { ExportFormat } from "@/features/resume/export/use-resume-export";
import type { LetterWords } from "@reactive-resume/resume/cover-letter";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import { letterPageData } from "./compose";
import { createExportFile, getDefaultFileName } from "@/features/resume/export/use-resume-export";
import { client } from "@/libs/orpc/client";

const asDocument = (letter: CoverLetter, words: LetterWords) => ({
	name: letter.name,
	slug: "",
	data: letterPageData(letter, words),
});

/** "First-Last-Cover-Letter", from the sender's name. */
export const letterFileName = (letter: CoverLetter, words: LetterWords) =>
	getDefaultFileName(asDocument(letter, words), "cover-letter");

/** The letter as a file: the page with its sender header, or JSON that imports back as a letter. */
export async function createLetterFile(letter: CoverLetter, words: LetterWords, format: ExportFormat): Promise<Blob> {
	if (format === "json") {
		const document = await client.coverLetters.export({ id: letter.id });
		return new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
	}
	return createExportFile(asDocument(letter, words), format, "cover-letter", { includeCoverLetterHeader: true });
}
