import { expect, it, vi } from "vite-plus/test";
import { strFromU8, unzipSync } from "fflate";
import { copyCoverLetterStyle, createCoverLetterResumeData } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

vi.mock("./pdf-document", () => ({ createResumePdfBlob: vi.fn() }));
const { createExportFile } = await import("./use-resume-export");

it.each(["docx", "odt"] as const)(
	"preserves explicit standalone header intent in browser %s downloads",
	async (format) => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Ada Lovelace";
		source.basics.email = "ada@example.com";
		const data = createCoverLetterResumeData({
			name: "Letter",
			recipient: "<p>Hiring team</p>",
			content: "<p>I build analytical engines.</p>",
			style: copyCoverLetterStyle(source),
		});
		const resume = { name: "Letter", slug: "", data };
		for (const standalone of [true, false]) {
			const blob = await createExportFile(resume, format, "cover-letter", { includeCoverLetterHeader: standalone });
			const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
			const xml = files[format === "docx" ? "word/document.xml" : "content.xml"];
			if (!xml) throw new Error("Missing document content");
			const text = strFromU8(xml).replace(/<[^>]+>/g, "");
			expect(text).toContain("Hiring teamI build analytical engines.");
			if (standalone) expect(text).toContain("Ada Lovelaceada@example.com");
			else expect(text).toBe("Hiring teamI build analytical engines.");
		}
	},
);
