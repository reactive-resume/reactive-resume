import { createPublicResumePdf } from "@reactive-resume/api/features/resume/public-pdf";

const noStoreResponse = (body: string, status: number) =>
	new Response(body, { status, headers: { "Cache-Control": "private, no-store" } });

const errorStatus = (error: unknown): number => {
	const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
	if (code === "NEED_PASSWORD") return 401;
	if (code === "NOT_FOUND") return 404;
	if (code === "RATE_LIMIT_EXCEEDED") return 429;
	return 500;
};

// Browsers keep the file but ask again on every use: the access checks run first, then a current copy gets 304.
// `private` keeps it out of shared caches; Vary names every input that decides access.
const cacheHeaders = (etag: string) => ({
	"Cache-Control": "private, no-cache",
	ETag: etag,
	Vary: "Cookie, Authorization, X-Api-Key",
});

export async function handlePublicResumePdf(
	request: Request,
	username: string,
	slug: string,
	trustedClient: string,
): Promise<Response> {
	// `?download` is the web page's Download PDF: saved as a file, and counted.
	const download = new URL(request.url).searchParams.has("download");
	try {
		const result = await createPublicResumePdf({
			username,
			slug,
			requestHeaders: request.headers,
			trustedClient,
			countDownload: download,
		});

		if (!result.body) return new Response(null, { status: 304, headers: cacheHeaders(result.etag) });

		return new Response(result.body, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `${download ? "attachment" : "inline"}; filename="${result.filename.replaceAll('"', "")}"`,
				"X-Content-Type-Options": "nosniff",
				...cacheHeaders(result.etag),
			},
		});
	} catch (error) {
		const status = errorStatus(error);
		if (status === 500) console.error("Public resume PDF generation failed", error);
		return noStoreResponse(
			status === 500 ? "Failed to generate public resume PDF" : "Public resume PDF unavailable",
			status,
		);
	}
}
