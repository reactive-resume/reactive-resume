/// <reference lib="webworker" />

import type { PdfWorkerRequest, PdfWorkerResponse } from "./pdf-document";
import type { PageMap } from "@reactive-resume/pdf/page-map";
import { createResumePdfBlob } from "@reactive-resume/pdf/browser";
import { createSectionTitleResolverForLocale } from "@/libs/resume/section-title-locale";

// Renders off the main thread, so typing, scrolling and the gallery stay smooth while a page is laid out.
self.addEventListener("message", async ({ data: request }: MessageEvent<PdfWorkerRequest>) => {
	const { id, data, template, renderOptions } = request;
	try {
		let pageMap: PageMap | undefined;
		const blob = await createResumePdfBlob({
			data,
			template,
			renderOptions,
			resolveSectionTitle: await createSectionTitleResolverForLocale(data.metadata.page.locale),
			onPageMap: (map) => {
				pageMap = map;
			},
		});
		self.postMessage({ id, blob, pageMap } satisfies PdfWorkerResponse);
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies PdfWorkerResponse);
	}
});
