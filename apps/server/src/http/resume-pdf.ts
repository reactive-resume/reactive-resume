import { createResumePdfDownload, verifyResumePdfDownloadToken } from "@reactive-resume/api/features/resume/export";

const downloadHeaders = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
};

const text = (body: string, status: number, extra: Record<string, string> = {}) =>
	new Response(body, { status, headers: { ...downloadHeaders, ...extra } });

function errorStatus(error: unknown) {
	const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
	if (code === "TOO_MANY_REQUESTS" || code === "RATE_LIMIT_EXCEEDED") return 429;
	return code === "NOT_FOUND" ? 404 : 500;
}

export async function handleResumePdfDownload(request: Request, id: string) {
	const searchParams = new URL(request.url).searchParams;
	const token = searchParams.get("token");
	if (!token) return text("Unauthorized", 401);

	const verification = verifyResumePdfDownloadToken({ resumeId: id, token });
	if (!verification.ok)
		return verification.reason === "expired" ? text("Download link expired", 410) : text("Unauthorized", 401);
	// Links made before letters left resumes may ask for the resume's cover letter, which is now a letter of its own.
	const target = searchParams.get("target");
	if (target && target !== "resume") return text("Not found", 404);

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
		if (status !== 429) return text("Couldn't generate the resume PDF. Try again.", status);
		return text("Too many PDF exports. Try again in a few minutes.", 429, {
			"Retry-After": String(reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60),
		});
	}
}
