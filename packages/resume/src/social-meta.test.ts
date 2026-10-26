import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vite-plus/test";
import { getResumeSocialMeta } from "./social-meta";

const buildData = (overrides: { name?: string; headline?: string; summary?: string }): ResumeData =>
	({
		basics: { name: overrides.name ?? "", headline: overrides.headline ?? "" },
		summary: { content: overrides.summary ?? "" },
	}) as ResumeData;

describe("getResumeSocialMeta", () => {
	it("strips markup and collapses whitespace out of the summary", () => {
		const meta = getResumeSocialMeta(
			buildData({ name: "Jane", summary: "<p>Builds   <strong>systems</strong>\n\nat scale.</p>" }),
		);

		expect(meta.description).toBe("Builds systems at scale.");
	});

	it("truncates a long summary on a word boundary", () => {
		const meta = getResumeSocialMeta(buildData({ name: "Jane", summary: "word ".repeat(80) }));

		expect(meta.description.length).toBeLessThanOrEqual(161);
		expect(meta.description.endsWith("word…")).toBe(true);
	});
});
