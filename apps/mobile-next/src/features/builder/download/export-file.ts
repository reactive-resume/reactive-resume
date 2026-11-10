import type { RouterOutput } from "@/api/client";
import { Directory, File, Paths } from "expo-file-system";
import { shareAsync } from "expo-sharing";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown, htmlToMarkdown } from "@reactive-resume/resume/markdown";
import { sanitizeFileName } from "@reactive-resume/utils/file";
import { generateId, fnv1a } from "@reactive-resume/utils/string";
import { letterBackup } from "./export-model";
import { pageRenderer } from "@/render/page-renderer";

export type ExportFormat = "pdf" | "docx" | "md" | "json" | "odt";
type Resume = RouterOutput["resume"]["getById"];
type Letter = RouterOutput["coverLetters"]["getById"];
export async function prepareExport(
	document: Resume | Letter,
	kind: "resume" | "letter",
	format: ExportFormat,
	name: string,
) {
	const directory = new Directory(Paths.cache, "document-exports", generateId());
	directory.create({ intermediates: true });
	const file = new File(directory, `${sanitizeFileName(name).slice(0, 120) || "Document"}.${format}`);
	if (format === "pdf") {
		const result = await pageRenderer.render({
			kind,
			id: document.id,
			revision:
				"revision" in document
					? document.revision
					: `${document.updatedAt.toISOString()}:${fnv1a(JSON.stringify(document.data))}`,
			...("data" in document ? { data: document.data } : {}),
		});
		if (result.stale) throw new Error("The page is out of date. Try again.");
		new File(result.pdfFile).copy(file);
	} else if (format === "json") {
		file.write(JSON.stringify("data" in document ? document.data : letterBackup(document), null, 2));
	} else if (format === "md") {
		if ("content" in document)
			file.write([document.greeting, htmlToMarkdown(document.content), document.signOff].filter(Boolean).join("\n\n"));
		else {
			const { getResumeSectionTitle } = await import("@reactive-resume/pdf/section-title");
			const data = getResumeExportData(document.data, "resume");
			file.write(buildMarkdown(data, (section) => getResumeSectionTitle(data, section)));
		}
	} else throw new Error("Connect to make this format.");
	return file;
}
export function deliverExport(file: File, save: boolean) {
	return deliverExports([file], save);
}
export async function deliverExports(files: File[], save: boolean) {
	if (save) {
		const directory = await Directory.pickDirectoryAsync();
		for (const file of files) {
			const destination = directory.createFile(file.name, file.type || null);
			file.copy(destination);
		}
	} else {
		for (const file of files) await shareAsync(file.uri, file.type ? { mimeType: file.type } : {});
	}
}
