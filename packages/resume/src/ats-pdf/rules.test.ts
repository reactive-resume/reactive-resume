import type { PdfRuleCode } from "./catalog";
import type { FixtureOptions } from "./test-fixtures";
import type { PdfAtsReport, RawExtraction } from "./types";
import { describe, expect, it } from "vitest";
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

	it("flags an oversized file and stays quiet about merely large ones", () => {
		expect(codesOf(healthyResume({ file: { sizeBytes: 4_000_000 } }))).toContain("FILE_TOO_LARGE");

		const large = report(healthyResume({ file: { sizeBytes: 1_500_000 } }));
		expect(statusOf(large, "FILE_TOO_LARGE")).toBe("pass");
		expect(statusOf(large, "LARGE_FILE_SIZE")).toBe("fail");
	});

	it("flags encrypted, XFA and portfolio files", () => {
		expect(codesOf(healthyResume({ metadata: { isEncrypted: true } }))).toContain("ENCRYPTED_PDF");
		expect(codesOf(healthyResume({ metadata: { isXfa: true } }))).toContain("XFA_FORM");
		expect(codesOf(healthyResume({ metadata: { isCollection: true } }))).toContain("PDF_PORTFOLIO");
		expect(codesOf(healthyResume({ metadata: { hasAcroForm: true } }))).toContain("ACROFORM_FIELDS");
	});

	it("reads font trouble off the font objects", () => {
		expect(codesOf(healthyResume({ fonts: [{ isType3: true }] }))).toContain("TYPE3_FONT");
		expect(codesOf(healthyResume({ fonts: [{ isInvalid: true }] }))).toContain("INVALID_EMBEDDED_FONT");
		expect(codesOf(healthyResume({ fonts: [{ missingFile: true }] }))).toContain("NON_EMBEDDED_FONTS");
	});

	it("skips font checks when no font objects were resolved", () => {
		const result = report(healthyResume({ fonts: [] }));

		expect(statusOf(result, "TYPE3_FONT")).toBe("skip");
		expect(skipReasonOf(result, "TYPE3_FONT")).toBe("insufficient-data");
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

	it("counts ligature glyphs", () => {
		expect(codesOf(healthyResume({ lines: [...healthyResumeLines, "ﬁrst ﬂow oﬃce workﬂow ﬄag"] }))).toContain(
			"LIGATURE_CHARACTERS",
		);
	});

	it("reports hidden text from the operator pass", () => {
		const hidden = healthyResume({ pages: { 1: { operators: { invisibleTextItems: 12, whiteFillTextItems: 4 } } } });
		const codes = codesOf(hidden);

		expect(codes).toContain("INVISIBLE_TEXT");
		expect(codes).toContain("WHITE_TEXT");
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

	it("flags rotated pages and non-standard page sizes", () => {
		expect(codesOf(healthyResume({ pages: { 1: { rotation: 90 } } }))).toContain("ROTATED_PAGES");
		expect(codesOf(healthyResume({ pages: { 1: { width: 400, height: 400 } } }))).toContain("NON_STANDARD_PAGE_SIZE");
	});

	it("reports a truncated analysis rather than implying full coverage", () => {
		expect(codesOf(healthyResume({ truncated: true }))).toContain("TRUNCATED_ANALYSIS");
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

	it("leaves a clean single-column page alone", () => {
		const result = report(healthyResume());

		expect(statusOf(result, "MULTI_COLUMN_LAYOUT")).toBe("pass");
		expect(statusOf(result, "COLUMN_GUTTER")).toBe("pass");
		expect(statusOf(result, "READING_ORDER_RISK")).toBe("pass");
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

	it("flags text drawn outside the page box", () => {
		expect(
			codesOf(makeRawExtraction({ lines: [...healthyResumeLines, { text: "Ada Lovelace", x: -40, y: 400 }] })),
		).toContain("TEXT_OUTSIDE_PAGE");
	});

	it("reports a running head repeated on every page", () => {
		const raw = makeRawExtraction({
			lines: [
				{ text: "Ada Lovelace — page 1", y: 8, page: 1 },
				{ text: "Experience at Analytical Engines", y: 120, page: 1 },
				{ text: "Ada Lovelace — page 2", y: 8, page: 2 },
				{ text: "Education at University of London", y: 120, page: 2 },
			],
			pageCount: 2,
		});

		expect(codesOf(raw)).toContain("REPEATED_HEADER_FOOTER");
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

	it("flags a document too thin to have extracted properly", () => {
		const thin = withLines([
			"Ada Lovelace, Principal Engineer",
			"ada@example.com and +44 20 7946 0100",
			"Analytical Engines, London, Jan 2020 - Present",
		]);

		expect(codesOf(thin)).toContain("VERY_SHORT_DOCUMENT");
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

	it("does not invent a split email on a clean file", () => {
		expect(statusOf(report(healthyResume()), "EMAIL_SPLIT_ACROSS_ITEMS")).toBe("pass");
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

	it("skips the link check when the file carries no link annotations", () => {
		expect(skipReasonOf(report(healthyResume()), "LINK_TEXT_URL_MISMATCH")).toBe("not-applicable");
	});
});

describe("date checks", () => {
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

	it("flags a future-dated range against the injected clock", () => {
		expect(codesOf(healthyResume({ lines: [...healthyResumeLines, "Jan 2030 - Dec 2031"] }))).toContain(
			"FUTURE_DATED_ENTRY",
		);
	});

	it("flags a range no recognised format matches", () => {
		// Two-digit years read as day numbers to most parsers, so nothing recognises this range.
		const codes = codesOf(healthyResume({ lines: [...healthyResumeLines, "Analyst, Somewhere | Jan 20 - Mar 22"] }));
		expect(codes).toContain("UNPARSEABLE_DATE_RANGE");
	});

	it("does not read a product name beside two years as a date range", () => {
		// "Framework 2021 - 2023" matches the shape of a period and is not one.
		const codes = codesOf(healthyResume({ lines: [...healthyResumeLines, "Built on Framework 2021 - 2023"] }));

		expect(codes).not.toContain("UNPARSEABLE_DATE_RANGE");
	});

	it("stays quiet on well-formed dates", () => {
		const result = report(healthyResume());

		expect(statusOf(result, "REVERSED_DATE_RANGE")).toBe("pass");
		expect(statusOf(result, "FUTURE_DATED_ENTRY")).toBe("pass");
		expect(statusOf(result, "UNPARSEABLE_DATE_RANGE")).toBe("pass");
	});
});

describe("content checks", () => {
	it("never lets a tip move the score", () => {
		const withTips = healthyResume({
			lines: [...healthyResumeLines, "I managed my own projects and I wrote my own documentation myself."],
		});

		const result = report(withTips);
		const firedTips = result.tips.map((tip) => tip.code);

		expect(firedTips).toContain("FIRST_PERSON_PRONOUNS");
		expect(result.score).toBe(report(healthyResume()).score);
	});

	it("reports an employment gap as advice, not as a defect", () => {
		const gapped = healthyResume({ lines: [...healthyResumeLines, "Jan 2005 - Dec 2006"] });
		const result = report(gapped);

		const gap = result.tips.find((tip) => tip.code === "EMPLOYMENT_GAP");
		expect(gap?.severity).toBe("tip");
		expect(result.findings.map((finding) => finding.code)).not.toContain("EMPLOYMENT_GAP");
	});
});
