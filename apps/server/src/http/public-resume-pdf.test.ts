import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	createPublicResumePdf: vi.fn(),
}));

vi.mock("@reactive-resume/api/features/resume/public-pdf", () => ({
	createPublicResumePdf: mocks.createPublicResumePdf,
}));

const { handlePublicResumePdf } = await import("./public-resume-pdf");
const trustedClient = "203.0.113.9";

describe("handlePublicResumePdf", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns the authorized on-demand PDF without forwarding compatibility metadata", async () => {
		const body = new File(["%PDF"], "Ada-Lovelace-Resume.pdf", { type: "text/plain" });
		mocks.createPublicResumePdf.mockResolvedValueOnce({
			body,
			filename: "Ada-Lovelace-Resume.pdf",
			etag: '"abc"',
		});
		const request = new Request("https://example.com/api/resumes/jane/resume/pdf?ignored=true", {
			headers: { "x-forwarded-for": "203.0.113.7" },
		});

		const response = await handlePublicResumePdf(request, "jane", "resume", trustedClient);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/pdf");
		expect(response.headers.get("Content-Disposition")).toBe('inline; filename="Ada-Lovelace-Resume.pdf"');
		expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
		expect(response.headers.get("ETag")).toBe('"abc"');
		expect(response.headers.get("Vary")).toBe("Cookie, Authorization, X-Api-Key");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await response.text()).toBe("%PDF");
		expect(mocks.createPublicResumePdf).toHaveBeenCalledWith({
			username: "jane",
			slug: "resume",
			requestHeaders: request.headers,
			trustedClient,
			countDownload: false,
		});
	});

	it("returns the Unicode full name in both RFC 5987 and legacy filename parts", async () => {
		mocks.createPublicResumePdf.mockResolvedValueOnce({
			body: new File(["%PDF"], "李明-Resume.pdf", { type: "text/plain" }),
			filename: "李明-Resume.pdf",
			etag: '"abc"',
		});
		const request = new Request("https://example.com/api/resumes/jane/untitled-resume/pdf?download");

		const response = await handlePublicResumePdf(request, "jane", "untitled-resume", trustedClient);

		expect(response.headers.get("Content-Disposition")).toBe(
			"attachment; filename=\"Resume.pdf\"; filename*=UTF-8''%E6%9D%8E%E6%98%8E-Resume.pdf",
		);
		expect(mocks.createPublicResumePdf).toHaveBeenCalledWith(
			expect.objectContaining({ countDownload: true, slug: "untitled-resume" }),
		);
	});

	it.each([
		{
			filename: '../../etc/passwd"\r\nX-Injected: yes\r\n\r\nAda-Lovelace-Resume.pdf',
			header: 'attachment; filename="etcpasswdX-Injected yesAda-Lovelace-Resume.pdf"',
		},
		{
			filename: "x＂;filename＊=UTF-8''evil.html;a=＂-Resume.pdf",
			header:
				"attachment; filename=\"x;filename=UTF-8''evil.html;a=-Resume.pdf\"; filename*=UTF-8''x%EF%BC%82%3Bfilename%EF%BC%8A%3DUTF-8%27%27evil.html%3Ba%3D%EF%BC%82-Resume.pdf",
		},
		{
			filename: "Ada＼Lovelace-Resume.pdf",
			header: "attachment; filename=\"AdaLovelace-Resume.pdf\"; filename*=UTF-8''Ada%EF%BC%BCLovelace-Resume.pdf",
		},
	])("keeps a stored name within the filename parameters: $filename", async ({ filename, header }) => {
		mocks.createPublicResumePdf.mockResolvedValueOnce({
			body: new File(["%PDF"], "resume.pdf", { type: "text/plain" }),
			filename,
			etag: '"abc"',
		});

		const response = await handlePublicResumePdf(
			new Request("https://example.com/api/resumes/jane/resume/pdf?download"),
			"jane",
			"resume",
			trustedClient,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/pdf");
		expect(await response.text()).toBe("%PDF");
		expect(response.headers.get("Content-Disposition")).toBe(header);
		expect(response.headers.get("X-Injected")).toBeNull();
	});

	it("answers a current copy with 304 and keeps refusals uncacheable", async () => {
		mocks.createPublicResumePdf.mockResolvedValueOnce({ body: null, filename: "李明-Resume.pdf", etag: '"abc"' });
		const current = await handlePublicResumePdf(
			new Request("https://example.com/api/resumes/jane/resume/pdf", { headers: { "if-none-match": '"abc"' } }),
			"jane",
			"resume",
			trustedClient,
		);
		expect(current.status).toBe(304);
		expect(current.headers.get("ETag")).toBe('"abc"');
		expect(current.headers.get("Cache-Control")).toBe("private, no-cache");
		expect(current.headers.get("Content-Disposition")).toBe(
			"inline; filename=\"Resume.pdf\"; filename*=UTF-8''%E6%9D%8E%E6%98%8E-Resume.pdf",
		);
		expect(await current.text()).toBe("");

		mocks.createPublicResumePdf.mockRejectedValueOnce({ code: "NEED_PASSWORD" });
		const locked = await handlePublicResumePdf(
			new Request("https://example.com/api/resumes/jane/resume/pdf", { headers: { "if-none-match": '"abc"' } }),
			"jane",
			"resume",
			trustedClient,
		);
		expect(locked.status).toBe(401);
		expect(locked.headers.get("Cache-Control")).toBe("private, no-store");
	});
});
