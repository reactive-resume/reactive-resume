import type { SectionTitleResolver } from "./section-title";
import type { PdfDocumentLike } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createElement } from "react";
import { analyzePdfResume, harvestPdfDocument, PDF_OPS } from "@reactive-resume/resume/ats-pdf";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { ResumeDocument } from "./document";
import { renderToBuffer } from "./forme/testing";

const NOW = new Date("2024-06-15T00:00:00Z");

const fixture = (name: string) =>
	new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/ats/${name}`, import.meta.url))));

/**
 * Section headings come from a resolver, not from the resume data — `title` is empty for every
 * stock section. Rendering without one produces a heading-less PDF that no real export looks
 * like, so the app's own behaviour is mirrored here.
 */
const resolveSectionTitle: SectionTitleResolver = (input) => input.defaultEnglishTitle ?? input.sectionId;

async function renderResume(data: ResumeData, template: Template = "onyx"): Promise<Uint8Array> {
	const element = createElement(ResumeDocument, { data, template, resolveSectionTitle }) as unknown as Parameters<
		typeof renderToBuffer
	>[0];
	return new Uint8Array(await renderToBuffer(element));
}

/** Runs the real browser pipeline in Node: pdf.js -> harvest -> analyze. */
async function analyze(bytes: Uint8Array, options: { name?: string } = {}) {
	// PDF.js transfers the buffer it is handed, detaching it — so each run gets its own copy and a
	// caller can analyse the same file twice.
	const loadingTask = getDocument({ data: new Uint8Array(bytes), fontExtraProperties: true });

	try {
		const document = (await loadingTask.promise) as unknown as PdfDocumentLike;
		const raw = await harvestPdfDocument(document, {
			file: { name: options.name ?? "resume.pdf", sizeBytes: bytes.byteLength, magicBytesOk: true },
		});

		return {
			raw,
			report: analyzePdfResume(raw, { now: NOW }),
		};
	} finally {
		await loadingTask.destroy();
	}
}

const failedCodes = (report: Awaited<ReturnType<typeof analyze>>["report"]) =>
	report.checks.filter((check) => check.status === "fail").map((check) => check.code);

describe("PDF operator numbers", () => {
	/**
	 * The engine hardcodes these so the universal package needs no pdf.js dependency. If a release
	 * ever renumbers an operator, this fails here rather than silently mis-reading every file.
	 */
	it("match the installed PDF.js build", () => {
		const actual = OPS as unknown as Record<string, number>;

		for (const [name, value] of Object.entries(PDF_OPS)) {
			expect(actual[name], name).toBe(value);
		}
	});
});

describe("a resume rendered by this app", () => {
	/**
	 * The regression guard for this whole feature: the app's own default single-column export has
	 * to come out clean. Anything the checker reports here, it reports to every user of this app,
	 * so a false positive shows up as a failing assertion rather than as lost trust.
	 */
	it("reports nothing that would cost a single-column export points", { timeout: 60_000 }, async () => {
		const { raw, report } = await analyze(await renderResume(sampleResumeData, "onyx"));

		expect(raw.pages.length).toBeGreaterThan(0);
		expect(raw.operatorsAvailable).toBe(true);
		expect(report.findings.map((finding) => finding.code)).toEqual([]);
		expect(report.score).toBe(100);
	});
});

describe("adversarial files", () => {
	it("calls a scan what it is", { timeout: 30_000 }, async () => {
		const { report } = await analyze(fixture("image-only-scan.pdf"), { name: "scan.pdf" });
		const codes = failedCodes(report);

		expect(codes).toContain("NO_TEXT_LAYER");
		expect(codes).toContain("IMAGE_ONLY_DOCUMENT");
		expect(report.score).toBeLessThanOrEqual(10);
	});

	it("reads a Type 3 font off the font object", { timeout: 30_000 }, async () => {
		const { raw, report } = await analyze(fixture("type3-font.pdf"), { name: "type3.pdf" });

		expect(raw.fonts.some((font) => font.isType3)).toBe(true);
		expect(failedCodes(report)).toContain("TYPE3_FONT");
		expect(report.score).toBeLessThanOrEqual(25);
	});

	it("sees nothing in text that was converted to outlines", { timeout: 30_000 }, async () => {
		const { raw, report } = await analyze(fixture("outlined-text.pdf"), { name: "outlined.pdf" });

		expect(raw.pages[0]?.items).toHaveLength(0);
		// The page is dense with drawing operations and empty of words — exactly the trap.
		expect(raw.pages[0]?.operators?.pathOpCount ?? 0).toBeGreaterThan(0);
		expect(failedCodes(report)).toContain("NO_TEXT_LAYER");
	});
});
