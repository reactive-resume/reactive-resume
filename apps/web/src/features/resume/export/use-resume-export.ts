import type { PublicResumePdfOptions } from "@/features/resume/public/public-pdf";
import type { ResumeExportTarget } from "@reactive-resume/resume/export-sections";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";
import { buildDocx } from "@reactive-resume/docx";
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { createResumePdfBlob } from "./pdf-document";
import { resolvePublicResumePdfBlob } from "@/features/resume/public/public-pdf";
import { client } from "@/libs/orpc/client";
import { createSectionTitleResolverForLocale } from "@/libs/resume/section-title-locale";

/**
 * Section titles are stored empty by default and resolved (locale-aware) at render time. PDF does
 * this via an injected resolver; DOCX and Markdown reuse the same resolution here so their section
 * headings aren't blank. Returns a `(sectionId) => title` function.
 */
const createSectionTitleResolver = async (data: ResumeData) => {
	const resolveSectionTitle = await createSectionTitleResolverForLocale(data.metadata.page.locale);
	const dataWithResolver = { ...data, resolveSectionTitle };
	return (sectionId: string) => getResumeSectionTitle(dataWithResolver, sectionId);
};

// ponytail: loosened from Resume to Pick so public-resume (where name may be "" for non-owners) can reuse
type ExportableResume = {
	id?: string;
	name: string;
	slug: string;
	data: ResumeData;
};

type UseResumeExportOptions = {
	publicResumePdf?: PublicResumePdfOptions;
};

type DownloadPdfOptions = {
	includeCoverLetterHeader?: boolean;
};

export type ExportFormat = "pdf" | "docx" | "md" | "json";

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

/** Builds one export file. It throws when the file can't be made, so each caller decides how to say so. */
export async function createExportFile(
	resume: ExportableResume,
	format: ExportFormat,
	target: ResumeExportTarget = "resume",
	options?: DownloadPdfOptions,
): Promise<Blob> {
	if (format === "json") {
		return new Blob([JSON.stringify(resume.data, null, 2)], { type: "application/json" });
	}

	const data = getResumeExportData(resume.data, target);
	if (format === "pdf") {
		return createResumePdfBlob(data, undefined, target === "cover-letter" ? options : undefined);
	}

	const resolveTitle = await createSectionTitleResolver(data);
	if (format === "md") return new Blob([buildMarkdown(data, resolveTitle)], { type: "text/markdown" });
	return buildDocx(data, resolveTitle);
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

/** One-click exports that report their own progress and failures in toasts (the bar, ⌘P, public pages). */
export function useResumeExport(resume: ExportableResume | undefined, exportOptions: UseResumeExportOptions = {}) {
	const [isExporting, setIsExporting] = useState(false);

	const onDownloadJSON = useCallback(async () => {
		if (!resume) return;
		try {
			downloadWithAnchor(await createExportFile(resume, "json"), `${getDefaultFileName(resume)}.json`);
		} catch {
			toast.add({ type: "error", description: t`Could not generate the JSON. Please try again.` });
		}
	}, [resume]);

	const onDownloadMarkdown = useCallback(async () => {
		if (!resume) return;
		try {
			const blob = await createExportFile(resume, "md");
			downloadWithAnchor(blob, `${getDefaultFileName(resume)}.md`);
		} catch {
			toast.add({ type: "error", description: t`Could not generate the Markdown. Please try again.` });
		}
	}, [resume]);

	const onDownloadDOCX = useCallback(async () => {
		if (!resume) return;
		try {
			const blob = await createExportFile(resume, "docx");
			downloadWithAnchor(blob, `${getDefaultFileName(resume)}.docx`);
		} catch {
			toast.add({ type: "error", description: t`Could not generate the DOCX. Please try again.` });
		}
	}, [resume]);

	const onDownloadPDF = useCallback(async () => {
		if (!resume) return;
		const toastId = toast.add({
			type: "loading",
			description: t`Generating your PDF...`,
		});
		setIsExporting(true);
		const makeBlob = () =>
			exportOptions.publicResumePdf
				? resolvePublicResumePdfBlob({ data: resume.data, ...exportOptions.publicResumePdf })
				: createExportFile(resume, "pdf");
		try {
			const blob = await makeBlob();
			downloadWithAnchor(blob, `${getDefaultFileName(resume)}.pdf`);
			if (exportOptions.publicResumePdf) {
				// Statistics are best effort and must not delay or fail a completed browser download.
				void client.resume.statistics.recordDownload(exportOptions.publicResumePdf.publicResume).catch(() => undefined);
			}
		} catch {
			toast.add({ type: "error", description: t`Could not generate the PDF. Please try again.` });
		}
		setIsExporting(false);
		toast.close(toastId);
	}, [exportOptions.publicResumePdf, resume]);

	const onPrint = useCallback(async () => {
		if (!resume) return;
		const toastId = toast.add({ type: "loading", description: t`Preparing your resume for printing...` });
		setIsExporting(true);
		const makeBlob = () =>
			exportOptions.publicResumePdf
				? resolvePublicResumePdfBlob({ data: resume.data, ...exportOptions.publicResumePdf })
				: createResumePdfBlob(resume.data);
		try {
			printPdf(await makeBlob());
		} catch {
			toast.add({
				type: "error",
				description: t`Could not prepare your resume for printing. Please try again.`,
			});
		}
		setIsExporting(false);
		toast.close(toastId);
	}, [exportOptions.publicResumePdf, resume]);

	return { onDownloadJSON, onDownloadMarkdown, onDownloadDOCX, onDownloadPDF, onPrint, isExporting };
}
