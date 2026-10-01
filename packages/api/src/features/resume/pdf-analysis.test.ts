import { expect, it, vi } from "vitest";
import { call } from "@orpc/server";
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
	verifyOAuthToken: vi.fn(),
}));
const { checkPdf } = await import("./checks");

// A complete, tiny one-page PDF; no network fonts, renderer, database or mocked PDF reader.
function pdfFile() {
	const stream = "BT /F1 12 Tf 50 700 Td (Ada Lovelace analytical engines) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let text = "%PDF-1.4\n";
	const offsets = objects.map((object, index) => {
		const offset = text.length;
		text += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xref = text.length;
	text += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return new File([text], "resume.pdf", { type: "application/pdf" });
}

it("checks an anonymous PDF upload with the real reader and rejects non-PDF bytes", async () => {
	const context = { locale: "en-US" as const, reqHeaders: new Headers(), trustedClient: "127.0.0.1" };
	const report = await call(checkPdf, { file: pdfFile() }, { context });
	expect(report.document).toMatchObject({ pageCount: 1, truncated: false, wordCount: 4 });
	expect(report.file.magicBytesOk).toBe(true);
	expect(report.fullText).toContain("Ada Lovelace analytical engines");
	await expect(call(checkPdf, { file: new File(["not a PDF"], "resume.pdf") }, { context })).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
});
