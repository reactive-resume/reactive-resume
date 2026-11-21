import type { RouterOutput } from "@/api/client";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { EXPORT_FILE_NAME_MAX_LENGTH } from "@reactive-resume/schema/resume/data";
import { sanitizeFileName } from "@reactive-resume/utils/file";
type Letter = RouterOutput["coverLetters"]["getById"];
export function letterBackup(letter: Letter) {
	const { name, recipient, content, greeting, signOff, layout, recipientName, recipientCompany, letterDate, style } =
		letter;
	return {
		format: "reactive-resume-cover-letter",
		version: 1,
		name,
		recipient,
		content,
		greeting,
		signOff,
		layout,
		recipientName,
		recipientCompany,
		letterDate,
		style,
	};
}

/** The name a resume's export starts from: the one saved with the resume, else the generated one. */
export function resumeExportName(saved: string | undefined, generated: string) {
	return sanitizeFileName(saved ?? "") || generated;
}

/** What an edited file name saves as: empty while it is the generated name, so that one keeps applying. */
export function savedResumeFileName(value: string, generated: string) {
	const next = sanitizeFileName(value).slice(0, EXPORT_FILE_NAME_MAX_LENGTH);
	return next === sanitizeFileName(generated) ? "" : next;
}

const withoutFileName = (data: ResumeData) => JSON.stringify({ ...data, metadata: { ...data.metadata, fileName: "" } });

/**
 * Whether a draft differs from the saved resume only in its file name. The page doesn't show the file name, so the
 * saved copy still makes the PDF while that edit waits to save (offline, say).
 */
export function differsOnlyInFileName(draft: ResumeData, saved: ResumeData) {
	return withoutFileName(draft) === withoutFileName(saved);
}
