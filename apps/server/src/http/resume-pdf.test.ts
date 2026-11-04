import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	createResumePdfDownload: vi.fn(),
	verifyResumePdfDownloadToken: vi.fn(),
}));

vi.mock("@reactive-resume/api/features/resume/export", () => ({
	createResumePdfDownload: mocks.createResumePdfDownload,
	verifyResumePdfDownloadToken: mocks.verifyResumePdfDownloadToken,
}));

const { handleResumePdfDownload } = await import("./resume-pdf");

describe("handleResumePdfDownload", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the PDF when the signed URL token is valid", async () => {
		const pdf = new File([new Uint8Array([37, 80, 68, 70])], "李明-Resume.pdf", { type: "application/pdf" });
		const disposition = "attachment; filename=\"Resume.pdf\"; filename*=UTF-8''%E6%9D%8E%E6%98%8E-Resume.pdf";
		mocks.verifyResumePdfDownloadToken.mockReturnValueOnce({
			ok: true,
			resumeId: "resume-1",
			userId: "user-1",
			expiresAt: "2026-06-01T10:10:00.000Z",
		});
		mocks.createResumePdfDownload.mockResolvedValueOnce({ headers: { "content-disposition": disposition }, body: pdf });

		const response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf?token=signed"),
			"resume-1",
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/pdf");
		// The API's RFC 5987 name is kept, not rebuilt from the file.
		expect(response.headers.get("Content-Disposition")).toBe(disposition);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await response.text()).toBe("%PDF");
		expect(mocks.createResumePdfDownload).toHaveBeenCalledWith({
			id: "resume-1",
			userId: "user-1",
			resHeaders: expect.any(Headers),
		});
	});

	it("rejects missing, invalid, and expired tokens before rendering", async () => {
		let response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf"),
			"resume-1",
		);
		expect(response.status).toBe(401);
		expect(mocks.createResumePdfDownload).not.toHaveBeenCalled();

		mocks.verifyResumePdfDownloadToken.mockReturnValueOnce({ ok: false, reason: "invalid_signature" });
		response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf?token=bad"),
			"resume-1",
		);
		expect(response.status).toBe(401);
		expect(mocks.createResumePdfDownload).not.toHaveBeenCalled();

		mocks.verifyResumePdfDownloadToken.mockReturnValueOnce({ ok: false, reason: "expired" });
		response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf?token=expired"),
			"resume-1",
		);
		expect(response.status).toBe(410);
		expect(mocks.createResumePdfDownload).not.toHaveBeenCalled();
	});
	it("answers a legacy cover-letter target as Not Found", async () => {
		mocks.verifyResumePdfDownloadToken.mockReturnValueOnce({ ok: true, resumeId: "resume-1", userId: "user-1" });
		const response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf?token=signed&target=cover-letter"),
			"resume-1",
		);
		expect(response.status).toBe(404);
		expect(await response.text()).toBe("Not Found");
		expect(mocks.createResumePdfDownload).not.toHaveBeenCalled();
	});
	it("returns the shared renderer's rate limit as HTTP 429", async () => {
		mocks.verifyResumePdfDownloadToken.mockReturnValueOnce({ ok: true, userId: "user-1" });
		mocks.createResumePdfDownload.mockRejectedValueOnce({
			code: "TOO_MANY_REQUESTS",
			data: { reset: Date.now() + 30_000 },
		});
		const response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf?token=signed"),
			"resume-1",
		);
		expect(response.status).toBe(429);
		expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
	});
});
