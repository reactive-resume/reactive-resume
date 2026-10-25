/// <reference lib="webworker" />

import type { PdfWorkerRequest, PdfWorkerResponse } from "./pdf-document";
import { preloadResumePdf } from "@reactive-resume/pdf/browser";
import { renderResumePdf } from "./render";

// Renders off the main thread, so typing, scrolling and the gallery stay smooth while a page is laid out.
self.addEventListener("message", async ({ data: request }: MessageEvent<PdfWorkerRequest>) => {
	const { id, ...input } = request;
	try {
		preloadResumePdf(input.data);
		self.postMessage({ id, ...(await renderResumePdf(input)) } satisfies PdfWorkerResponse);
	} catch (error) {
		const cause = error instanceof Error && typeof error.cause === "string" ? error.cause : undefined;
		self.postMessage({
			id,
			error: error instanceof Error ? error.message : String(error),
			cause,
		} satisfies PdfWorkerResponse);
	}
});
