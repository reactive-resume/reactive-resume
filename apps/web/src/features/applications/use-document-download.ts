import { t } from "@lingui/core/macro";
import { useState } from "react";
import { downloadWithAnchor, generateFilename } from "@reactive-resume/utils/file";
import { toastError } from "@/libs/error-message";
import { client } from "@/libs/orpc/client";

/** Downloads the current draft of a linked resume or letter as a PDF; `downloading` is the busy document's id. */
export function useDocumentDownload() {
	const [downloading, setDownloading] = useState<string | null>(null);
	const download = async (kind: "resume" | "letter", documentId: string) => {
		setDownloading(documentId);
		try {
			const { createExportFile } = await import("@/features/resume/export/use-resume-export");
			if (kind === "resume") {
				const resume = await client.resume.getById({ id: documentId });
				downloadWithAnchor(await createExportFile(resume, "pdf"), generateFilename(resume.name, "pdf"));
			} else {
				const letter = await client.coverLetters.getById({ id: documentId });
				const { createLetterWordsForLocale, letterPageData } = await import("@/features/letters/compose");
				const words = await createLetterWordsForLocale(letter.style.metadata.page.locale);
				const data = letterPageData(letter, words);
				downloadWithAnchor(
					await createExportFile({ name: letter.name, slug: "", data }, "pdf", "cover-letter", {
						includeCoverLetterHeader: true,
					}),
					generateFilename(letter.name, "pdf"),
				);
			}
		} catch (error) {
			toastError(error, t`Couldn't generate the PDF. Try again.`);
		} finally {
			setDownloading(null);
		}
	};
	return { download, downloading };
}
