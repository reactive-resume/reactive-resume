import { beforeEach, describe, expect, it, vi } from "vitest";

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
		const pdf = new File([new Uint8Array([37, 80, 68, 70])], "Scizor.pdf", { type: "application/pdf" });
		mocks.verifyResumePdfDownloadToken.mockReturnValueOnce({
			ok: true,
			resumeId: "resume-1",
			userId: "user-1",
			expiresAt: "2026-06-01T10:10:00.000Z",
		});
		mocks.createResumePdfDownload.mockResolvedValueOnce({
			headers: { "content-disposition": 'attachment; filename="Scizor.pdf"' },
			body: pdf,
		});

		const response = await handleResumePdfDownload(
			new Request("https://example.com/api/resumes/resume-1/pdf?token=signed"),
			"resume-1",
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/pdf");
		expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Scizor.pdf"');
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
