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

export async function handlePublicResumePdf(
	request: Request,
	username: string,
	slug: string,
	trustedClient = "unknown",
): Promise<Response> {
	try {
		const result = await createPublicResumePdf({
			username,
			slug,
			requestHeaders: request.headers,
			trustedClient,
		});

		return new Response(result.body, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `inline; filename="${result.filename.replaceAll('"', "")}"`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
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
