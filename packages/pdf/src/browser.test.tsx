import { describe, expect, it, vi } from "vitest";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";

const rendererMock = vi.hoisted(() => ({
	renderResume: vi.fn(async () => ({
		pdf: new TextEncoder().encode("%PDF"),
		pageMap: { pages: [], nodes: [] },
		layout: { pages: [] },
		missingFonts: [] as string[],
		warnings: [],
	})),
}));

vi.mock("./forme/render", async (importOriginal) => ({
	...(await importOriginal<typeof import("./forme/render")>()),
	renderResume: rendererMock.renderResume,
}));
vi.mock("@formepdf/core/worker", () => ({ init: vi.fn(async () => {}) }));

describe("createResumePdfBlob", () => {
	it("rejects when a font can't be downloaded, so callers fall back to the server's PDF", async () => {
		rendererMock.renderResume.mockResolvedValueOnce({
			pdf: new TextEncoder().encode("%PDF"),
			pageMap: { pages: [], nodes: [] },
			layout: { pages: [] },
			missingFonts: ["Source Sans 3"],
			warnings: [],
		});
		const { createResumePdfBlob } = await import("./browser");

		await expect(createResumePdfBlob({ data: sampleResumeData })).rejects.toThrow("Source Sans 3");
	});
});
