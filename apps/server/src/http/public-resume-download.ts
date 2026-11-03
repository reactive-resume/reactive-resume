import { createPublicResumeDocx } from "@reactive-resume/api/features/resume/public-download";
import { createPublicResumePdf } from "@reactive-resume/api/features/resume/public-pdf";
import { publicResumePath } from "@reactive-resume/resume/sharing";
import { contentDisposition } from "@reactive-resume/utils/http";

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

export async function handlePublicResumeDownload(
	request: Request,
	username: string,
	slug: string,
	trustedClient: string,
	format: "pdf" | "docx" = "pdf",
): Promise<Response> {
	// `?download` is the web page's Download PDF: saved as a file, and counted.
	const download = format === "docx" || new URL(request.url).searchParams.has("download");
	try {
		const input = {
			username,
			slug,
			requestHeaders: request.headers,
			trustedClient,
			countDownload: download,
		};
		if (format === "docx") {
			const result = await createPublicResumeDocx(input);
			return new Response(result.body, {
				headers: {
					...result.headers,
					"Content-Type": result.body.type,
					"Cache-Control": "private, no-store",
					Vary: "Cookie, Authorization, X-Api-Key",
					"X-Content-Type-Options": "nosniff",
				},
			});
		}
		const result = await createPublicResumePdf(input);

		const headers = {
			...cacheHeaders(result.etag),
			"Content-Disposition": contentDisposition(result.filename, download ? "attachment" : "inline"),
		};
		if (!result.body) return new Response(null, { status: 304, headers });

		return new Response(result.body, {
			headers: {
				"Content-Type": "application/pdf",
				"X-Content-Type-Options": "nosniff",
				...headers,
			},
		});
	} catch (error) {
		const status = errorStatus(error);
		if (status === 500) console.error("Public resume download failed", error);
		// A person following a shared PDF link gets the web page, which asks for the password or says it isn't shared.
		const browser = (request.headers.get("accept") ?? "").includes("text/html");
		if (browser && (status === 401 || status === 404))
			return new Response(null, {
				status: 303,
				headers: { Location: publicResumePath({ username, slug }), "Cache-Control": "private, no-store" },
			});
		return noStoreResponse(
			status === 401
				? "This resume is password-protected. Open its web page to enter the password."
				: status === 404
					? "This resume's download isn't available."
					: "Couldn't create the file. Try again in a minute.",
			status,
		);
	}
}
