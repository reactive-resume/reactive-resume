import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { resolvePublicResumePdfBlob } from "./public-pdf";

const mocks = vi.hoisted(() => ({
	createResumePdfBlob: vi.fn(async () => new Blob(["local"], { type: "application/pdf" })),
	fetch: vi.fn(async (_input: string | URL) => new Response(new Blob(["server"], { type: "application/pdf" }))),
}));

vi.mock("@/features/resume/export/pdf-document", () => ({
	createResumePdfBlob: mocks.createResumePdfBlob,
}));

const publicResume = { username: "amruth", slug: "sample" };

beforeEach(() => {
	mocks.createResumePdfBlob.mockReset();
	mocks.createResumePdfBlob.mockResolvedValue(new Blob(["local"], { type: "application/pdf" }));
	mocks.fetch.mockReset();
	mocks.fetch.mockResolvedValue(new Response(new Blob(["server"], { type: "application/pdf" })));
	vi.stubGlobal("fetch", mocks.fetch);
});

describe("resolvePublicResumePdfBlob", () => {
	it("shows the server's PDF without starting the browser renderer", async () => {
		const blob = await resolvePublicResumePdfBlob({ data: sampleResumeData, publicResume });

		expect(mocks.fetch).toHaveBeenCalledWith("/api/resumes/amruth/sample/pdf", { credentials: "include" });
		expect(await blob.text()).toBe("server");
		expect(mocks.createResumePdfBlob).not.toHaveBeenCalled();
	});

	it("renders in the browser when the server can't serve the PDF", async () => {
		mocks.fetch.mockResolvedValue(new Response("Too many requests", { status: 429 }));

		const blob = await resolvePublicResumePdfBlob({ data: sampleResumeData, publicResume });

		expect(mocks.createResumePdfBlob).toHaveBeenCalledWith(sampleResumeData);
		expect(await blob.text()).toBe("local");
	});
});
