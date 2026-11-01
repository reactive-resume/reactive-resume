import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Independent parser for downloaded Forme output; no system Poppler installation required. */
export async function extractPdfText(bytes: Uint8Array) {
	const task = getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false });
	const document = await task.promise;
	try {
		const pages: string[] = [];
		for (let page = 1; page <= document.numPages; page++) {
			const content = await (await document.getPage(page)).getTextContent();
			pages.push(content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" "));
		}
		return pages.join("\n");
	} finally {
		await task.destroy();
	}
}
