import { describe, expect, it } from "vite-plus/test";
import { strFromU8, unzipSync } from "fflate";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { buildOdtFiles, ODT_MIME_TYPE } from "./builder";
import { htmlToOdtBlocks } from "./html-to-odt";
import { buildOdt } from "./index";

const resolveTitle = (sectionId: string) => ({ experience: "Experience", education: "Education" })[sectionId];

/** The document's text in reading order, without markup. */
const contentText = (data: typeof sampleResumeData) =>
	(buildOdtFiles(data, resolveTitle)["content.xml"] ?? "")
		.replace(/<\/text:(p|h)>/g, "\n")
		.replace(/<[^>]+>/g, "")
		.trim();

describe("buildOdt", () => {
	it("writes an OpenDocument archive with an uncompressed mimetype first", async () => {
		const bytes = new Uint8Array(await (await buildOdt(sampleResumeData, resolveTitle)).arrayBuffer());

		// Office suites sniff the type from the fixed offset after the first local header (ODF 1.3, part 2, §3.3).
		expect(strFromU8(bytes.subarray(30, 38 + ODT_MIME_TYPE.length))).toBe(`mimetype${ODT_MIME_TYPE}`);
		const files = unzipSync(bytes);
		expect(Object.keys(files)).toEqual(["mimetype", "META-INF/manifest.xml", "content.xml", "styles.xml", "meta.xml"]);
		expect(strFromU8(files["content.xml"] ?? new Uint8Array())).toContain("Cascade Studios");
	});
});

describe("buildOdtFiles", () => {
	// The builder lays out every template the same way, so one document covers them all.
	it("puts the header first, once", () => {
		const data = structuredClone(sampleResumeData);
		const text = contentText(data);

		expect(text.startsWith(data.basics.name)).toBe(true);
		expect(text.split(data.basics.name)).toHaveLength(2);
	});

	it("drops characters XML forbids, so pasted control characters can't corrupt the file", () => {
		const data = structuredClone(sampleResumeData);
		data.basics.email = "david\u0002@email.com";
		data.summary.content = "<p>Ships\u0001 games\uFFFE</p>";
		const content = buildOdtFiles(data, resolveTitle)["content.xml"] ?? "";

		for (const character of ["\u0001", "\u0002", "\uFFFE"]) expect(content).not.toContain(character);
		expect(content).toContain("mailto:david@email.com");
		expect(content).toContain("Ships games");
	});

	it("prints only the letter, without the resume header, for a cover-letter export", () => {
		const data = structuredClone(sampleResumeData);
		data.customSections.push({
			id: "letter",
			type: "cover-letter",
			title: "Cover Letter",
			icon: "mail",
			columns: 1,
			hidden: false,
			showHeading: true,
			keepTogether: false,
			startOnNewPage: false,
			items: [
				{ id: "item", hidden: false, recipient: "<p>Hiring Manager</p>", content: "<p>Dear Hiring Manager,</p>" },
			],
		});
		data.metadata.layout.pages.push({ fullWidth: true, main: ["letter"], sidebar: [] });

		expect(contentText(getResumeExportData(data, "cover-letter"))).toBe("Hiring Manager\nDear Hiring Manager,");
	});
});

describe("htmlToOdtBlocks", () => {
	it("maps TipTap blocks and keeps only safe links", () => {
		const blocks = htmlToOdtBlocks(
			'<h2>Sub</h2><ul><li><p>One</p><ul><li><p>Nested</p></li></ul></li></ul><ol><li><p>First</p></li></ol><blockquote><p>Quoted</p></blockquote><pre>a\nb</pre><hr><p data-indent="2"><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>',
		);

		expect(blocks.map((block) => (block.type === "paragraph" ? (block.style ?? block.indent) : block.type))).toEqual([
			"heading",
			"list",
			"list",
			"Quote",
			"CodeBlock",
			"rule",
			2,
		]);
		expect(blocks[4]).toMatchObject({ children: [{ text: "a" }, { type: "break" }, { text: "b" }] });
		const nested = blocks[1]?.type === "list" ? blocks[1].items[0]?.blocks[1] : undefined;
		expect(nested?.type).toBe("list");
		expect(blocks.at(-1)).toMatchObject({
			children: [
				{ type: "text", text: "bad" },
				{ type: "text", text: " " },
				{ type: "link", href: "https://example.com/" },
			],
		});
	});
});
