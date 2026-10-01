import { expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "../server";

async function exportText(html: string, font = "Noto Sans", locale = "en-US") {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.summary.content = html;
	data.metadata.page.locale = locale;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.metadata.typography.body.fontFamily = font;
	data.metadata.typography.heading.fontFamily = font;
	const file = await createResumePdfFile({ data, filename: "text.pdf" });
	const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	const document = await task.promise;
	try {
		const pages: string[] = [];
		for (let page = 1; page <= document.numPages; page++) {
			const content = await (await document.getPage(page)).getTextContent();
			pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(""));
		}
		return pages.join("\n").replace(/\s+/g, " ");
	} finally {
		await task.destroy();
	}
}

it.each([
	["שלום עולם ניסיון עבודה", "Noto Sans Hebrew", "he-IL"],
	["שָׁלוֹם עוֹלָם", "Noto Sans Hebrew", "he-IL"],
	["مرحبا بالعالم مهندس برمجيات", "Noto Sans Arabic", "ar-SA"],
	["مَرْحَبًا بِالْعَالَمِ", "Noto Sans Arabic", "ar-SA"],
	["नमस्ते दुनिया अनुभव कौशल", "Noto Sans Devanagari", "hi-IN"],
	["प्रशिक्षण क्षेत्र दृष्टि क्षत्रिय", "Noto Sans Devanagari", "hi-IN"],
	["日本語の履歴書 職務経験", "Noto Sans JP", "ja-JP"],
	["Hello 💻 engineer 🚀 coding 😀", "Noto Sans", "en-US"],
	["Family 👨‍👩‍👧‍👦 love 👩‍❤️‍💋‍👩 ❤️", "Noto Sans", "en-US"],
] as const)("preserves exported Unicode text: %s", { timeout: 60_000 }, async (text, font, locale) => {
	expect(await exportText(`<p>${text}</p>`, font, locale)).toContain(text);
});

it.each(["span", "em", "a"])(
	"preserves word separators inside unmarked inline %s",
	{ timeout: 60_000 },
	async (tag) => {
		expect(
			await exportText(`<p>Hello<${tag}${tag === "a" ? ' href="https://example.com"' : ""}> world</${tag}></p>`),
		).toContain("Hello world");
	},
);

it("reports unsupported characters instead of returning a successful lossy export", { timeout: 60_000 }, async () => {
	await expect(exportText("<p>Unsupported \u{10FFFF}</p>")).rejects.toThrow(/text.*render|font/i);
});
