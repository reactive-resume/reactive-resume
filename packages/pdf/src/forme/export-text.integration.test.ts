import { execFileSync } from "node:child_process";
import { expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { act } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "../server";
import { lostCharacters, renderResume } from "./render";

function summaryResume(html: string, font = "Noto Sans", locale = "en-US") {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.summary.content = html;
	data.metadata.page.locale = locale;
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.metadata.typography.body.fontFamily = font;
	data.metadata.typography.heading.fontFamily = font;
	return data;
}

async function exportText(html: string, font = "Noto Sans", locale = "en-US") {
	const data = summaryResume(html, font, locale);
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
	// The page language alone picks the Devanagari fallback for the default font.
	["अमित शर्मा", "IBM Plex Serif", "hi-IN"],
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

it('exports characters no font can draw as "?" and names them', { timeout: 60_000 }, async () => {
	expect(await exportText("<p>Unsupported \u{10FFFF}</p>")).toContain("Unsupported ?");
	const result = await act(() => renderResume(forme, { data: summaryResume("<p>Unsupported \u{10FFFF}</p>") }));
	expect(lostCharacters(result.warnings)).toEqual([expect.stringContaining("U+10FFFF")]);
});

it.each([
	["अमित शर्मा", "hi-IN"],
	["अमित शर्मा हिन्दी", "en-US"],
	["অমিত শর্মা", "bn-BD"],
	["அமித் சர்மா", "en-US"],
	["అమిత్ శర్మ", "te-IN"],
	["അമിത് ശർമ്മ", "ml-IN"],
	["ಅಮಿತ್ ಶರ್ಮಾ", "kn-IN"],
	["ଅମିତ ଶର୍ମା", "or-IN"],
	["ਅਮਿਤ ਸ਼ਰਮਾ", "en-US"],
	["અમિત શર્મા", "en-US"],
	["අමිත් ශර්මා", "en-US"],
	["አሚት ሻርማ", "am-ET"],
	["អមិត ស្រម៉ា", "km-KH"],
	["Designer 👩🏽‍💻 coder", "en-US"],
] as const)(
	"draws %s through a script fallback for the default font (%s)",
	{ timeout: 60_000 },
	async (text, locale) => {
		const data = summaryResume(`<p>${text}</p>`, "IBM Plex Serif", locale);
		const result = await act(() => renderResume(forme, { data }));
		expect(lostCharacters(result.warnings)).toBeNull();
	},
);
