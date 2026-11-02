import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { Directory, File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { letterWords } from "./letter";
import { getLostCharactersMessage } from "./messages";
import { safeFileName } from "./model";
import { client, rest } from "@/api/client";
import { createPreviewPipeline } from "@/preview/pipeline";
import { showToast } from "@/ui";

export type ExportFormat = "pdf" | "docx" | "odt" | "md" | "json";
const mime = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	odt: "application/vnd.oasis.opendocument.text",
	md: "text/markdown",
	json: "application/json",
};

/** Only sweep old task-owned batches. Android recipients can read files after the share promise resolves. */
export function exportDirectory() {
	for (const entry of Paths.cache.list()) {
		if (entry instanceof Directory && /^resume-export-\d+$/.test(entry.name)) {
			const created = Number(entry.name.slice("resume-export-".length));
			if (Date.now() - created > 24 * 60 * 60 * 1000) {
				try {
					entry.delete();
				} catch {
					/* Cache cleanup must not block a new export. */
				}
			}
		}
	}
	const directory = new Directory(Paths.cache, `resume-export-${Date.now()}`);
	directory.create({ intermediates: true, idempotent: true });
	return directory;
}

export async function localPdf(data: ResumeData, letter = false) {
	const pipeline = createPreviewPipeline();
	try {
		const result = await pipeline.render({
			id: 1,
			data: getResumeExportData(data, letter ? "cover-letter" : "resume"),
			scale: 1,
			pages: [],
			renderOptions: { includeCoverLetterHeader: letter },
		});
		return { pdf: result.pdf, lostCharacters: result.lostCharacters, hasTextLoss: result.hasTextLoss };
	} finally {
		await pipeline.dispose();
	}
}

function warnTextLoss(result: Awaited<ReturnType<typeof localPdf>>) {
	if (result.hasTextLoss || result.lostCharacters.length) {
		showToast({ message: getLostCharactersMessage(result.lostCharacters), duration: 10000 });
	}
}

type ExportFileOptions = {
	directory: Directory;
	id: string;
	name: string;
	format: ExportFormat;
	data?: ResumeData;
	letter?: boolean;
	/** The letter's page language, when the caller already read the letter: saves reading it again. */
	letterLocale?: string;
};

export async function exportFile({ directory, id, name, format, data, letter, letterLocale }: ExportFileOptions) {
	let bytes: Uint8Array;
	if (format === "pdf" && data) {
		const result = await localPdf(data, letter);
		bytes = result.pdf;
		warnTextLoss(result);
	} else {
		let query = "";
		if (letter && format !== "json") {
			const locale = letterLocale ?? (await client.coverLetters.getById({ id })).style.metadata.page.locale;
			const words = await letterWords(locale);
			query = `?${new URLSearchParams({
				"words[greeting]": words.greeting("{name}"),
				"words[teamGreeting]": words.teamGreeting,
				"words[hiringTeam]": words.hiringTeam,
				"words[signOff]": words.signOff,
			})}`;
		}
		const response = await rest(
			`/${letter ? "cover-letters" : "resumes"}/${encodeURIComponent(id)}/exports/${format}${query}`,
		);
		if (!response.ok) throw new Error(t`Couldn't generate this file. Try again, or download PDF instead.`);
		bytes = new Uint8Array(await response.arrayBuffer());
	}
	const file = new File(directory, `${safeFileName(name) || "document"}.${format}`);
	await file.write(bytes);
	return file;
}

export async function shareExport(file: File, format: ExportFormat) {
	if (!(await Sharing.isAvailableAsync())) throw new Error(t`File sharing is unavailable on this device.`);
	await Sharing.shareAsync(file.uri, { mimeType: mime[format], dialogTitle: t`Save or share file` });
}

export async function printResume(data: ResumeData, name: string) {
	const file = new File(exportDirectory(), `${safeFileName(name) || "resume"}.pdf`);
	const result = await localPdf(data);
	warnTextLoss(result);
	await file.write(result.pdf);
	await Print.printAsync({ uri: file.uri });
}

/** Exports the current draft of a linked resume or letter as a PDF and opens the platform Save/Share sheet. */
export async function shareDocumentPdf(kind: "resume" | "letter", id: string, name: string) {
	const file = await exportFile({ directory: exportDirectory(), id, name, format: "pdf", letter: kind === "letter" });
	await shareExport(file, "pdf");
}
