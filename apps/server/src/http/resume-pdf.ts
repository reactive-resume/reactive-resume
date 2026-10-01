import { createResumePdfDownload, verifyResumePdfDownloadToken } from "@reactive-resume/api/features/resume/export";

const downloadHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
};

function unauthorizedResponse() {
	return new Response("Unauthorized", {
		status: 401,
		headers: downloadHeaders,
	});
}

function expiredResponse() {
	return new Response("Download link expired", {
		status: 410,
		headers: downloadHeaders,
	});
}

function errorStatus(error: unknown) {
	const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
	if (code === "TOO_MANY_REQUESTS" || code === "RATE_LIMIT_EXCEEDED") return 429;
	return code === "NOT_FOUND" ? 404 : 500;
}

export async function handleResumePdfDownload(request: Request, id: string) {
	const searchParams = new URL(request.url).searchParams;
	const token = searchParams.get("token");
	if (!token) return unauthorizedResponse();

	const verification = verifyResumePdfDownloadToken({ resumeId: id, token });
	if (!verification.ok) return verification.reason === "expired" ? expiredResponse() : unauthorizedResponse();
	// Links made before letters left resumes may ask for the resume's cover letter, which is now a letter of its own.
	const target = searchParams.get("target");
	if (target && target !== "resume") return new Response("Not found", { status: 404, headers: downloadHeaders });

	try {
		const resHeaders = new Headers();
		const download = await createResumePdfDownload({ id, userId: verification.userId, resHeaders });

		return new Response(download.body, {
			headers: {
				...Object.fromEntries(resHeaders),
				"Content-Type": download.body.type || "application/pdf",
				"Content-Disposition": download.headers["content-disposition"],
				...downloadHeaders,
			},
		});
	} catch (error) {
		const status = errorStatus(error);
		if (status === 500) console.error("[PDF Download]", { name: error instanceof Error ? error.name : "Unknown" });
		const reset =
			typeof error === "object" && error && "data" in error ? (error.data as { reset?: number })?.reset : undefined;
		return new Response(
			status === 429 ? "Too many PDF exports. Retry after the rate limit resets." : "Failed to generate resume PDF",
			{
				status,
				headers: {
					...downloadHeaders,
					...(status === 429 && {
						"Retry-After": String(reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60),
					}),
				},
			},
		);
	}
}
