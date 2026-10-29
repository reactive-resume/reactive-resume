import type { ResumeExportTarget } from "@reactive-resume/resume/export-sections";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { createResumePdfBlob } from "./pdf-document";
import { getLostCharactersMessage, getReadableErrorMessage } from "@/libs/error-message";

// DOCX and ODT are large and only some exports need them; they load when one starts.
const loadDocx = () => import("@reactive-resume/docx");
const loadOdt = () => import("@reactive-resume/odt");

/** Starts loading the DOCX and ODT builders, for controls that lead to those formats. */
export const preloadDocumentExport = () => {
	void loadDocx();
	void loadOdt();
	void import("@reactive-resume/pdf/section-title");
};

type ExportableResume = {
	name: string;
	slug: string;
	data: ResumeData;
};

type ExportOptions = {
	includeCoverLetterHeader?: boolean;
};

export type ExportFormat = "pdf" | "docx" | "odt" | "md" | "json";

// Characters Windows and macOS won't take in a file name.
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]/g;

/** A file name as the user typed it, minus the characters file systems reject. */
export const sanitizeFileName = (value: string) => value.replace(UNSAFE_FILE_NAME_CHARACTERS, "").trim();

/**
 * "First-Last-Resume" (or "First-Last-Cover-Letter"): recruiters see this name. Without a name on the
 * resume it falls back to the document's name.
 */
export function getDefaultFileName(resume: ExportableResume, target: ResumeExportTarget = "resume") {
	const words = (text: string) => sanitizeFileName(text).split(/\s+/).filter(Boolean);
	const person = words(resume.data.basics.name);
	const suffix = target === "cover-letter" ? ["Cover", "Letter"] : ["Resume"];
	if (person.length > 0) return [...person, ...suffix].join("-");
	return [...words(resume.name || resume.slug), ...(target === "cover-letter" ? suffix : [])].join("-") || "Resume";
}

// The file still downloads, with "?" for each character no font can draw.
const warnLostCharacters = (characters: string[]) =>
	toast.add({ type: "warning", id: "pdf-lost-characters", description: getLostCharactersMessage(characters) });

/** Builds one export file. It throws when the file can't be made, so each caller decides how to say so. */
export async function createExportFile(
	resume: ExportableResume,
	format: ExportFormat,
	target: ResumeExportTarget = "resume",
	options?: ExportOptions,
): Promise<Blob> {
	if (format === "json") {
		return new Blob([JSON.stringify(resume.data, null, 2)], { type: "application/json" });
	}

	const data = getResumeExportData(resume.data, target);
	if (format === "pdf") {
		return createResumePdfBlob(data, target === "cover-letter" ? options : undefined, {
			onLostCharacters: warnLostCharacters,
		});
	}

	// Section titles are stored empty by default; DOCX, ODT and Markdown use the PDF's localized headings.
	const { getResumeSectionTitle } = await import("@reactive-resume/pdf/section-title");
	const resolveTitle = (sectionId: string) => getResumeSectionTitle(data, sectionId);
	if (format === "md") return new Blob([buildMarkdown(data, resolveTitle)], { type: "text/markdown" });
	const renderOptions = target === "cover-letter" ? options : undefined;
	if (format === "odt") return (await loadOdt()).buildOdt(data, resolveTitle, renderOptions);
	return (await loadDocx()).buildDocx(data, resolveTitle, renderOptions);
}

/** Prints a PDF blob through a hidden iframe; if the browser blocks that, opens it in a new tab instead. */
function printPdf(blob: Blob) {
	const url = URL.createObjectURL(blob);
	// ponytail: print the generated PDF via a hidden iframe (reliable in Chromium). If the browser
	// blocks iframe printing, fall back to opening the PDF in a new tab so the user can print manually.
	const iframe = document.createElement("iframe");
	iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
	iframe.src = url;
	iframe.onload = () => {
		try {
			iframe.contentWindow?.focus();
			iframe.contentWindow?.print();
		} catch {
			window.open(url, "_blank", "noopener");
		}
		setTimeout(() => {
			iframe.remove();
			URL.revokeObjectURL(url);
		}, 60_000);
	};
	document.body.appendChild(iframe);
}

/** One-click exports that report their own progress and failures in toasts (the bar, ⌘P). */
export function useResumeExport(resume: ExportableResume) {
	const [isExporting, setIsExporting] = useState(false);

	const onDownloadPDF = async () => {
		const toastId = toast.add({
			type: "loading",
			description: t`Generating PDF…`,
		});
		setIsExporting(true);
		try {
			const blob = await createExportFile(resume, "pdf");
			downloadWithAnchor(blob, `${getDefaultFileName(resume)}.pdf`);
		} catch (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't generate the PDF. Try again.`),
			});
		}
		setIsExporting(false);
		toast.close(toastId);
	};

	const onPrint = async () => {
		const toastId = toast.add({ type: "loading", description: t`Preparing resume for printing…` });
		setIsExporting(true);
		try {
			printPdf(await createResumePdfBlob(resume.data, undefined, { onLostCharacters: warnLostCharacters }));
		} catch (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't prepare the resume for printing. Try again.`),
			});
		}
		setIsExporting(false);
		toast.close(toastId);
	};

	return { onDownloadPDF, onPrint, isExporting };
}
