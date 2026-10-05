import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { act } from "react";
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
	const file = await act(() => createResumePdfFile({ data, filename: "text.pdf" }));
	// PDF.js ignores /ActualText and infers separators from glyph positions, which corrupts
	// shaped clusters and emoji. Poppler reads the PDF's logical text, including these spans.
	const text = execFileSync("pdftotext", ["-enc", "UTF-8", "-", "-"], {
		input: Buffer.from(await file.arrayBuffer()),
		encoding: "utf8",
	});
	// Poppler adds directional wrappers and page/line separators; keep source marks and joiners.
	return text.replace(/[\u202A-\u202E]/g, "").replace(/\s+/g, " ");
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
	["LessPass 6.1k⭐★ rated ★★★☆☆", "IBM Plex Sans", "en-US"],
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
