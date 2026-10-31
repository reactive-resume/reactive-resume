import type { RouterOutput } from "@/libs/orpc/client";
import { strToU8, zipSync } from "fflate";
import { slugify } from "@reactive-resume/utils/slug";

type AccountExport = RouterOutput["auth"]["exportData"];

const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

// The whole id keeps two documents with the same name apart. Ids are UUIDv7, so a prefix is only a timestamp and repeats.
const fileName = (name: string, id: string) => `${slugify(name)}-${id}.json`;

/**
 * "Export everything": account, documents, applications with their stages, and career records, including source metadata and conversations.
 * Extract the archive to import individual resumes and letters; the other files are records. Attachments remain references.
 */
export function buildAccountZip(data: AccountExport): Uint8Array {
	const files: Record<string, Uint8Array> = {
		"account.json": json({ exportedAt: data.exportedAt, user: data.user }),
		"applications.json": json(data.applications),
		// Stage definitions, including removed ones that history still names. Servers before custom stages omit them.
		...(data.applicationPipeline ? { "application-stages.json": json(data.applicationPipeline) } : {}),
		"career.json": json(data.career),
		...(data.applicationProfile ? { "application-profile.json": json(data.applicationProfile) } : {}),
		"ai-content-reports.json": json(data.aiContentReports),
	};
	for (const resume of data.resumes) files[`resumes/${fileName(resume.name, resume.id)}`] = json(resume);
	for (const letter of data.coverLetters) {
		files[`letters/${fileName(letter.name, letter.id)}`] = json({
			...letter,
			format: "reactive-resume-cover-letter",
			version: 1,
		});
	}
	return zipSync(files);
}
