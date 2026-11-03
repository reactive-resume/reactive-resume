import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { execFileSync } from "node:child_process";
import { expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { act, createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "../server";
import { Document, Page, Text } from "./primitives";
import { lostCharacters, renderResume, renderResumeElement } from "./render";

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

it(
	'measures the "?" it draws for unsupported characters, retaining their warning and authored text',
	{ timeout: 60_000 },
	async () => {
		const html = "<p>Before \u{10FFFF}\u{10FFFF}\u{10FFFF} AFTER</p>";
		const data = summaryResume(html, "IBM Plex Serif");
		const result = await act(() => renderResume(forme, { data }));
		const bbox = execFileSync("pdftotext", ["-bbox", "-", "-"], { input: result.pdf, encoding: "utf8" });
		const replacementEnd = Number(bbox.match(/<word[^>]*xMax="([\d.]+)"[^>]*>\?\?\?<\/word>/)?.[1]);
		const followingStart = Number(bbox.match(/<word xMin="([\d.]+)"[^>]*>AFTER<\/word>/)?.[1]);
		expect(replacementEnd).toBeGreaterThan(0);
		expect(followingStart).toBeGreaterThan(replacementEnd);
		expect(lostCharacters(result.warnings)).toEqual([expect.stringContaining("U+10FFFF")]);
		expect(data.summary.content).toBe(html);
	},
);

type MixedFontsProps = { data: ResumeData };

function MixedFonts({ data }: MixedFontsProps) {
	return createElement(
		Document,
		null,
		createElement(
			Page,
			null,
			createElement(Text, { style: { fontFamily: "Helvetica" } }, `Before ${data.basics.name} AFTER`),
			createElement(Text, { style: { fontFamily: "STIX Two Text" } }, data.basics.name),
		),
	);
}

it(
	"preserves a character supported by another text's font when repairing its unsupported occurrence",
	{ timeout: 60_000 },
	async () => {
		const data = summaryResume("", "STIX Two Text");
		data.basics.name = "∕";
		const result = await act(() => renderResumeElement(forme, createElement(MixedFonts, { data })));
		const text = execFileSync("pdftotext", ["-", "-"], { input: result.pdf, encoding: "utf8" });
		expect(text).toContain("Before ? AFTER");
		expect(text).toContain("∕");
		expect(lostCharacters(result.warnings)).toEqual([expect.stringContaining("U+2215")]);
	},
);

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
