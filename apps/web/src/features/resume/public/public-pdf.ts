import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type PublicResumePdfOptions = {
	publicResume: {
		username: string;
		slug: string;
	};
};

type PublicResume = PublicResumePdfOptions["publicResume"];

// useBreakpoint's tablet query: from here up, public-resume.tsx shows the PDF instead of the reflow.
const PDF_LAYOUT_QUERY = "(min-width: 640px)";

const fetchPublicResumePdf = async ({ username, slug }: PublicResume) => {
	const response = await fetch(`/api/resumes/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/pdf`, {
		credentials: "include",
	});
	if (!response.ok) throw new Error(`Public PDF request failed with ${response.status}`);
	return response.blob();
};

const prefetched = new Map<string, Promise<Blob | null>>();
const keyOf = ({ username, slug }: PublicResume) => `${username}/${slug}`;

/**
 * Starts the server's PDF, the viewer and the pdf.js worker while the page's data loads, so the first page doesn't wait for
 * them one after another. Only where the page shows the PDF.
 */
export function prefetchPublicResumePdf(publicResume: PublicResume) {
	if (typeof window === "undefined" || !window.matchMedia?.(PDF_LAYOUT_QUERY).matches) return;
	const key = keyOf(publicResume);
	if (!prefetched.has(key))
		prefetched.set(
			key,
			fetchPublicResumePdf(publicResume).catch(() => null),
		);
	void import("./pdf-viewer").catch(() => undefined);
	void import("@/features/resume/preview/pdfjs").then(({ getPdfWorker }) => getPdfWorker()).catch(() => undefined);
}

/**
 * The server renders and caches the public PDF, so visitors don't download the PDF engine (several MB). The browser
 * renders it only when the server can't (offline, rate limited, failed render).
 */
export async function resolvePublicResumePdfBlob({
	data,
	publicResume,
}: PublicResumePdfOptions & { data: ResumeData }): Promise<Blob> {
	const key = keyOf(publicResume);
	// A prefetch serves one read: later reads (a refetched resume, Download) ask again and get the current file.
	const early = prefetched.get(key);
	prefetched.delete(key);
	const served = await (early ?? fetchPublicResumePdf(publicResume).catch(() => null));
	if (served) return served;
	const { createResumePdfBlob } = await import("@/features/resume/export/pdf-document");
	return createResumePdfBlob(data);
}
