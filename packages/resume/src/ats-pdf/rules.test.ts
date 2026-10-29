import type { PdfRuleCode } from "./catalog";
import type { FixtureOptions } from "./test-fixtures";
import type { PdfAtsReport, RawExtraction } from "./types";
import { describe, expect, it } from "vite-plus/test";
import { analyzePdfResume } from "./index";
import { healthyResume, healthyResumeLines, makeRawExtraction, scannedResume, twoColumnResume } from "./test-fixtures";

const NOW = new Date("2024-06-15T00:00:00Z");

const report = (raw: RawExtraction) => analyzePdfResume(raw, { now: NOW });

const codesOf = (raw: RawExtraction) =>
	report(raw)
		.checks.filter((check) => check.status === "fail")
		.map((check) => check.code);

const statusOf = (result: PdfAtsReport, code: PdfRuleCode) =>
	result.checks.find((check) => check.code === code)?.status;

const skipReasonOf = (result: PdfAtsReport, code: PdfRuleCode) =>
	result.checks.find((check) => check.code === code)?.skipReason;

const withLines = (lines: readonly string[], overrides: FixtureOptions = {}) =>
	makeRawExtraction({ lines, ...overrides });

describe("parseability checks", () => {
	it("caps a file with no text layer", () => {
		const result = report(withLines([]));

		expect(statusOf(result, "NO_TEXT_LAYER")).toBe("fail");
		expect(result.score).toBeLessThanOrEqual(10);
		expect(result.cappedBy).toContain("NO_TEXT_LAYER");
	});

	it("reports a scan as image-only rather than merely empty", () => {
		const codes = codesOf(scannedResume());

		expect(codes).toContain("IMAGE_ONLY_DOCUMENT");
		expect(codes).toContain("HIGH_IMAGE_COVERAGE");
	});

	it("treats private-use glyphs as garbled without needing to know the language", () => {
		const glyphs = Array.from({ length: 24 }, (_, index) => String.fromCodePoint(0xe0_00 + index)).join("");
		const garbled = withLines([glyphs, glyphs, glyphs]);

		const result = report(garbled);
		expect(statusOf(result, "GARBLED_TEXT")).toBe("fail");
		expect(result.score).toBeLessThanOrEqual(25);
	});

	it("skips the English-only garble signals on text it cannot read as English", () => {
		const japanese = withLines(
			[
				"職務経歴書 山田太郎 東京都渋谷区",
				"株式会社サンプル 二〇二〇年一月から現在まで",
				"ソフトウェアエンジニアとして基幹システムの設計と実装を担当",
				"データベースの最適化により処理時間を四十パーセント削減",
			],
			{ metadata: { language: "ja" } },
		);

		expect(skipReasonOf(report(japanese), "GARBLED_TEXT")).toBe("not-english");
	});

	it("skips operator-dependent checks when the operator pass did not run", () => {
		const result = report(healthyResume({ pages: { 1: { operators: null } }, operatorsAvailable: false }));

		expect(skipReasonOf(result, "INVISIBLE_TEXT")).toBe("no-operators");
		expect(skipReasonOf(result, "IMAGE_ONLY_DOCUMENT")).toBe("no-operators");
		expect(result.document.operatorsAvailable).toBe(false);
	});

	it("notices letter-by-letter emission", () => {
		const spaced = makeRawExtraction({
			lines: healthyResumeLines.map((line) =>
				typeof line === "string" ? { text: line, perCharacter: true } : { ...line, perCharacter: true },
			),
		});

		expect(codesOf(spaced)).toContain("SPLIT_CHARACTER_SPACING");
	});
});

describe("layout checks", () => {
	it("caps a genuine two-column layout that also threads out of order", () => {
		const result = report(twoColumnResume());

		expect(statusOf(result, "MULTI_COLUMN_LAYOUT")).toBe("fail");
		expect(result.score).toBeLessThanOrEqual(55);
		expect(result.cappedBy).toContain("MULTI_COLUMN_LAYOUT");
	});

	it("warns instead of capping when only the gutter signal is strong", () => {
		// Same geometry, but the stream stores the page in reading order.
		const inOrder = twoColumnResume({
			streamOrder: (lines) => [...lines].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)),
		});

		const result = report(inOrder);

		expect(statusOf(result, "MULTI_COLUMN_LAYOUT")).toBe("pass");
		expect(statusOf(result, "COLUMN_GUTTER")).toBe("fail");
		expect(result.cappedBy).not.toContain("MULTI_COLUMN_LAYOUT");
		expect(result.score).toBeGreaterThan(55);
	});

	it("flags small body text and tight margins", () => {
		const small = makeRawExtraction({
			lines: healthyResumeLines.map((line) =>
				typeof line === "string" ? { text: line, size: 7 } : { ...line, size: 7 },
			),
		});

		expect(codesOf(small)).toContain("SMALL_BODY_TEXT");

		const cramped = makeRawExtraction({
			lines: healthyResumeLines.map((line, index) =>
				typeof line === "string" ? { text: line, x: 4, y: 4 + index * 14 } : { ...line, x: 4, y: 4 + index * 14 },
			),
		});

		expect(codesOf(cramped)).toContain("NARROW_PAGE_MARGINS");
	});

	it("does not let one stray line define the page margin", () => {
		// A single element pushed to the edge is not a narrow margin; the other thirty lines are
		// where the margin actually is.
		const oneOutlier = makeRawExtraction({ lines: [...healthyResumeLines, { text: "Ada", x: 2, y: 600 }] });

		expect(codesOf(oneOutlier)).not.toContain("NARROW_PAGE_MARGINS");
	});

	it("only reports the header and footer strip when contact details are in it", () => {
		const decorative = makeRawExtraction({ lines: [...healthyResumeLines, { text: "Curriculum Vitae", y: 4 }] });
		const contactInFooter = makeRawExtraction({ lines: [...healthyResumeLines, { text: "ada@example.com", y: 4 }] });

		expect(codesOf(decorative)).not.toContain("TEXT_IN_MARGIN_ZONE");
		expect(codesOf(contactInFooter)).toContain("TEXT_IN_MARGIN_ZONE");
	});

	it("accepts a heading set bold at body size", () => {
		const boldHeadings = makeRawExtraction({
			lines: healthyResumeLines.map((line) =>
				typeof line === "object" && line.size === 12 ? { ...line, size: 10, fontRef: "g_d0_f2" } : line,
			),
		});

		expect(codesOf(boldHeadings)).not.toContain("HEADINGS_NOT_DISTINGUISHED");
	});
});

describe("section checks", () => {
	it("caps a resume with no employment history of any kind", () => {
		const withoutWork = healthyResumeLines.filter(
			(line) => !(typeof line === "object" && ["EXPERIENCE", "PROJECTS"].includes(line.text)),
		);

		const result = report(makeRawExtraction({ lines: withoutWork }));

		expect(statusOf(result, "NO_EXPERIENCE_SECTION")).toBe("fail");
		expect(result.score).toBeLessThanOrEqual(60);
	});

	it("accepts projects or volunteering as equivalent history", () => {
		const withoutExperience = healthyResumeLines.filter(
			(line) => !(typeof line === "object" && line.text === "EXPERIENCE"),
		);

		expect(statusOf(report(makeRawExtraction({ lines: withoutExperience })), "NO_EXPERIENCE_SECTION")).toBe("pass");
	});

	it("skips heading-based checks on a resume that is not in English", () => {
		const german = withLines(
			[
				"Lebenslauf von Max Mustermann",
				"Berufserfahrung bei einer Musterfirma in Berlin seit Januar 2020",
				"Verantwortlich für die Entwicklung und den Betrieb interner Systeme",
				"Ausbildung an der Technischen Universität München von 2011 bis 2015",
			],
			{ metadata: { language: "de" } },
		);

		expect(skipReasonOf(report(german), "NO_EXPERIENCE_SECTION")).toBe("not-english");
	});

	/**
	 * The bronzor template sets each section title in a narrow column beside the section's
	 * content, so baseline clustering merges the heading into the first content line
	 * ("Profiles GitHub"). The heading is still a separate run in its own column and the
	 * check has to find it there.
	 */
	it("finds headings set in a side column beside the first line of content", () => {
		const bronzorLike = makeRawExtraction({
			lines: [
				{ text: "Ada Lovelace", size: 18 },
				"ada@example.com · +44 20 7946 0100 · London, UK",
				{ text: "Profiles", x: 33, y: 200, size: 9, fontRef: "g_d0_f2" },
				{ text: "github.com/adalovelace", x: 201, y: 200 },
				{ text: "Experience", x: 33, y: 250, size: 9, fontRef: "g_d0_f2" },
				{ text: "Principal Engineer | Analytical Engines, London", x: 201, y: 250 },
				{ text: "Jan 2020 - Present", x: 201, y: 265 },
				{ text: "• Delivered a note-taking programme that cut calculation time by 40%.", x: 201, y: 280 },
				{ text: "Education", x: 33, y: 320, size: 9, fontRef: "g_d0_f2" },
				{ text: "University of London | Mathematics", x: 201, y: 320 },
				{ text: "Sep 2011 - Jun 2015", x: 201, y: 335 },
				{ text: "Skills", x: 33, y: 370, size: 9, fontRef: "g_d0_f2" },
				{ text: "Algorithms, numerical analysis, technical writing", x: 201, y: 370 },
				{ text: "Summary", x: 33, y: 400, size: 9, fontRef: "g_d0_f2" },
				{ text: "Analytical engineer who builds calculation systems.", x: 201, y: 400 },
			],
		});

		const result = report(bronzorLike);

		expect(statusOf(result, "NO_RECOGNIZED_HEADINGS")).toBe("pass");
		expect(statusOf(result, "NO_EXPERIENCE_SECTION")).toBe("pass");
		expect(statusOf(result, "NO_EDUCATION_SECTION")).toBe("pass");
		expect(statusOf(result, "NO_SKILLS_SECTION")).toBe("pass");
		expect(statusOf(result, "NO_SUMMARY_SECTION")).toBe("pass");
	});
});

describe("contact checks", () => {
	it("caps a resume with no email address", () => {
		const withoutEmail = healthyResumeLines.filter(
			(line) => typeof line !== "string" || !line.includes("ada@example.com"),
		);

		const result = report(makeRawExtraction({ lines: withoutEmail }));

		expect(statusOf(result, "NO_EMAIL")).toBe("fail");
		expect(result.score).toBeLessThanOrEqual(50);
	});

	it("detects an address broken across text runs", () => {
		const split = makeRawExtraction({
			lines: [
				...healthyResumeLines
					.filter((line) => typeof line !== "string" || !line.includes("ada@example.com"))
					.map((line, index) =>
						typeof line === "string" ? { text: line, y: 120 + index * 14 } : { ...line, y: 120 + index * 14 },
					),
				{ text: "ada", x: 56, y: 80 },
				{ text: "@", x: 90, y: 80 },
				{ text: "example.com", x: 120, y: 80 },
			],
		});

		expect(codesOf(split)).toContain("EMAIL_SPLIT_ACROSS_ITEMS");
	});

	it("reports a link whose visible text names a different destination", () => {
		const raw = makeRawExtraction({
			lines: [{ text: "https://github.com/adalovelace", x: 56, y: 60, size: 10 }],
			links: [{ page: 1, url: "https://tracking.example.net/click", rect: [56, 771, 300, 785] }],
		});

		expect(codesOf(raw)).toContain("LINK_TEXT_URL_MISMATCH");
	});

	it("does not mistake the domain half of an email for a link's visible text", () => {
		const raw = makeRawExtraction({
			lines: [
				...healthyResumeLines,
				{ text: "ada@example.com", x: 56, y: 400 },
				{ text: "https://github.com/adalovelace", x: 260, y: 400 },
			],
			// The annotation covers only the link, but both sit on one clustered line.
			links: [{ page: 1, url: "https://github.com/adalovelace", rect: [260, 431, 420, 445] }],
		});

		expect(codesOf(raw)).not.toContain("LINK_TEXT_URL_MISMATCH");
	});

	it("does not invent a split address from two columns sharing a line", () => {
		const twoColumnRow = makeRawExtraction({
			lines: [
				...healthyResumeLines,
				{ text: "ada@example.com", x: 56, y: 400 },
				{ text: "Led the analytical engine programme across four teams", x: 300, y: 400 },
			],
		});

		expect(codesOf(twoColumnRow)).not.toContain("EMAIL_SPLIT_ACROSS_ITEMS");
	});
});

describe("date checks", () => {
	it.each([false, true])("recognizes Onyx year ranges beside role words (separate runs: %s)", (separateRuns) => {
		const datedLines = [
			["Clinical Research Coordinator", "2022 – Present"],
			["Clinical Research Coordinator", "2019 – 2022"],
			["Clinical Research", "2013 – 2017"],
			["Community Skills Network", "2023 – Present"],
		] as const;
		const raw = makeRawExtraction({
			lines: datedLines.flatMap(([text, period], index) =>
				separateRuns
					? [
							{ text, x: 56, y: 60 + index * 30 },
							{ text: period, x: 440, y: 60 + index * 30 },
						]
					: [{ text: `${text} ${period}` }],
			),
		});

		const result = report(raw);
		expect(statusOf(result, "NO_DATES_FOUND")).toBe("pass");
		expect(statusOf(result, "MIXED_DATE_FORMATS")).toBe("pass");
	});

	it("caps a resume with no dates at all", () => {
		const undated = healthyResumeLines.filter((line) => typeof line !== "string" || !/\d{4}/.test(line));
		const result = report(makeRawExtraction({ lines: undated }));

		expect(statusOf(result, "NO_DATES_FOUND")).toBe("fail");
		expect(result.score).toBeLessThanOrEqual(60);
	});

	it("flags a reversed range", () => {
		expect(codesOf(healthyResume({ lines: [...healthyResumeLines, "Mar 2022 - Jan 2020"] }))).toContain(
			"REVERSED_DATE_RANGE",
		);
	});

	it("flags a range no recognised format matches", () => {
		// Two-digit years read as day numbers to most parsers, so nothing recognises this range.
		const codes = codesOf(healthyResume({ lines: [...healthyResumeLines, "Analyst, Somewhere | Jan 20 - Mar 22"] }));
		expect(codes).toContain("UNPARSEABLE_DATE_RANGE");
	});

	it("does not report a product name beside years as a malformed date", () => {
		const codes = codesOf(healthyResume({ lines: [...healthyResumeLines, "Built on Framework 2021 - 2023"] }));

		expect(codes).not.toContain("UNPARSEABLE_DATE_RANGE");
	});

	it.each([
		"Framework 20 - Product 22",
		"Jan 2020 - Framework 2023",
		"Framework 2021 - Product 2023",
		"NotMay2020 - Present",
		"12020 - 2023",
	])("rejects non-date words inside a range: %s", (text) => {
		const result = report(
			withLines([
				"Research specialist delivering clinical studies with multidisciplinary teams and patient groups.",
				text,
			]),
		);
		expect(statusOf(result, "UNPARSEABLE_DATE_RANGE")).toBe("pass");
		expect(statusOf(result, "NO_CURRENT_ROLE_MARKER")).toBe("skip");
	});

	it("preserves localized months beside role titles", () => {
		const result = report(
			withLines(
				[
					"Ingenieur Januar 2020 – April 2022",
					"Verantwortlich für die Entwicklung und den Betrieb interner Systeme in Berlin.",
				],
				{ metadata: { language: "de" } },
			),
		);

		expect(statusOf(result, "NO_DATES_FOUND")).toBe("pass");
		expect(statusOf(result, "UNPARSEABLE_DATE_RANGE")).toBe("pass");
		expect(statusOf(result, "NO_CURRENT_ROLE_MARKER")).toBe("fail");
	});
});
