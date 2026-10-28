import type { InlineStyle, OdtBlock, OdtInline, OdtListItem, SectionTitleResolver } from "./types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { isCoverLetterOnlyDocument } from "@reactive-resume/resume/export-sections";
import { assertResumeRenderBudget } from "@reactive-resume/schema/resume/limits";
import { toSafeLink } from "@reactive-resume/utils/link";
import { isRTL } from "@reactive-resume/utils/locale";
import { toHex } from "./html-to-odt";
import { renderSection } from "./sections";
import { paragraph, text } from "./types";
import { escapeXml } from "./xml";

// --- ODF namespaces ---

const OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const STYLE_NS = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const FO_NS = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const SVG_NS = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const META_NS = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
const MANIFEST_NS = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const NS_DECLARATIONS = [
	`xmlns:office="${OFFICE_NS}"`,
	`xmlns:style="${STYLE_NS}"`,
	`xmlns:text="${TEXT_NS}"`,
	`xmlns:fo="${FO_NS}"`,
	`xmlns:xlink="${XLINK_NS}"`,
	`xmlns:svg="${SVG_NS}"`,
].join(" ");

// --- Units ---

/** Rounds to a fixed number of decimals to keep the generated XML compact. */
function round(value: number, digits = 1): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/** Points (as stored in resume metadata) to centimetres (as ODF expects). */
const ptToCm = (pt: number) => round((pt * 2.54) / 72, 3);

// DOCX/ODT have fixed pages; free-form resumes intentionally fall back to A4.
const A4_PAGE_SIZE = { width: 21, height: 29.7 };
const LETTER_PAGE_SIZE = { width: 21.59, height: 27.94 };

// --- Body ---

/**
 * Names content-dependent text properties (inline colours, highlights) as automatic styles T1, T2, …,
 * reusing a name when the same properties recur.
 */
type TextStyleNamer = (properties: string) => string;

/** Maps an inline style to the ODF text styles it needs. */
function inlineStyleNames(style: InlineStyle, textStyle: TextStyleNamer): string[] {
	const names: string[] = [];
	if (style.code) names.push("Code");
	if (style.bold) names.push("Bold");
	if (style.italic) names.push("Italic");
	if (style.underline) names.push("Underline");
	if (style.strike) names.push("Strike");
	if (style.color) names.push(textStyle(`fo:color="#${style.color}"`));
	if (style.highlight) names.push(textStyle(`fo:background-color="#${style.highlight}"`));
	return names;
}

/** Serialises a run of inline nodes to ODF XML. */
function serializeInline(nodes: readonly OdtInline[], textStyle: TextStyleNamer): string {
	return nodes.map((node) => serializeInlineNode(node, textStyle)).join("");
}

/** Serialises a single inline node to ODF XML. */
function serializeInlineNode(node: OdtInline, textStyle: TextStyleNamer): string {
	switch (node.type) {
		case "tab":
			return "<text:tab/>";
		case "break":
			return "<text:line-break/>";
		case "link":
			return `<text:a xlink:type="simple" xlink:href="${escapeXml(node.href)}"><text:span text:style-name="Link">${serializeInline(node.children, textStyle)}</text:span></text:a>`;
		case "text": {
			let output = escapeXml(node.text);
			for (const style of inlineStyleNames(node.style, textStyle)) {
				output = `<text:span text:style-name="${style}">${output}</text:span>`;
			}
			return output;
		}
	}
}

/** Serialises one list item, nesting any blocks it contains. */
function serializeListItem(item: OdtListItem, textStyle: TextStyleNamer): string {
	let inner = "";
	for (const block of item.blocks) {
		if (block.type === "paragraph" && !block.style && !block.indent) {
			inner += `<text:p text:style-name="ListParagraph">${serializeInline(block.children, textStyle)}</text:p>`;
		} else {
			inner += serializeBlock(block, textStyle);
		}
	}
	return `<text:list-item>${inner || "<text:p/>"}</text:list-item>`;
}

/** Serialises a block (heading, list, paragraph or rule) to ODF XML. */
function serializeBlock(block: OdtBlock, textStyle: TextStyleNamer): string {
	switch (block.type) {
		case "rule":
			return '<text:p text:style-name="Rule"/>';
		case "heading": {
			const level = Math.min(Math.max(block.level, 1), 6);
			return `<text:h text:outline-level="${level}" text:style-name="SectionHeading">${serializeInline(block.children, textStyle)}</text:h>`;
		}
		case "list": {
			const style = block.ordered ? "NumberList" : "BulletList";
			const items = block.items.map((item) => serializeListItem(item, textStyle)).join("");
			return `<text:list text:style-name="${style}">${items}</text:list>`;
		}
		case "paragraph": {
			const style = block.indent ? `Indent${Math.min(block.indent, 8)}` : (block.style ?? "Body");
			return `<text:p text:style-name="${style}">${serializeInline(block.children, textStyle)}</text:p>`;
		}
	}
}

// --- Header ---

/** Builds the name, headline and contact line that head the document. */
function buildHeaderBlocks(data: ResumeData): OdtBlock[] {
	const { basics } = data;
	const blocks: OdtBlock[] = [];

	if (basics.name) blocks.push(paragraph([text(basics.name)], "Title"));
	if (basics.headline) blocks.push(paragraph([text(basics.headline)], "Subtitle"));

	const contact: OdtInline[] = [];
	const add = (label: string, link?: string) => {
		if (!label) return;
		const href = link ? toSafeLink(link) : null;
		if (contact.length > 0) contact.push(text("  |  "));
		contact.push(href ? { type: "link", href, children: [text(label)] } : text(label));
	};

	add(basics.email, `mailto:${basics.email}`);
	add(basics.phone);
	add(basics.location);
	const website = toSafeLink(basics.website.url);
	if (website) add(basics.website.label || website, website);
	for (const field of basics.customFields) add(field.text, field.link);

	if (contact.length > 0) blocks.push(paragraph(contact, "Contact"));

	return blocks;
}

// --- Style sheet ---

/** Declares the body, heading and code font faces used by the stylesheet. */
function fontFaceDecls(bodyFont: string, headingFont: string): string {
	return [
		"<office:font-face-decls>",
		`<style:font-face style:name="BodyFont" svg:font-family="${escapeXml(`'${bodyFont}'`)}"/>`,
		`<style:font-face style:name="HeadingFont" svg:font-family="${escapeXml(`'${headingFont}'`)}"/>`,
		`<style:font-face style:name="CodeFont" svg:font-family="${escapeXml("'Courier New', monospace")}"/>`,
		"</office:font-face-decls>",
	].join("");
}

type StyleConfig = {
	bodySize: number;
	headingSize: number;
	nameSize: number;
	codeSize: number;
	lineHeightPercent: number;
	primary: string;
	textColor: string;
	headingFont: string;
	bodyFont: string;
};

/** Builds `styles.xml`: page setup, paragraph/character styles and list styles. */
function buildStylesXml(
	config: StyleConfig,
	page: {
		width: number;
		height: number;
		marginX: number;
		marginY: number;
		background: string;
		writingMode: "lr-tb" | "rl-tb";
	},
): string {
	const textWidth = page.width - page.marginX * 2;
	const { primary, textColor } = config;

	const paragraphStyles = [
		`<style:style style:name="Body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.12cm"/></style:style>`,
		`<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.08cm"/><style:text-properties style:font-name="HeadingFont" fo:font-size="${config.nameSize}pt" fo:font-weight="bold" fo:color="#${primary}"/></style:style>`,
		`<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.15cm"/><style:text-properties fo:font-size="${config.bodySize}pt" fo:font-style="italic" fo:color="#${textColor}"/></style:style>`,
		`<style:style style:name="Contact" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.35cm"/><style:text-properties fo:font-size="${config.bodySize}pt" fo:color="#${textColor}"/></style:style>`,
		`<style:style style:name="SectionHeading" style:family="paragraph" style:parent-style-name="Standard" style:default-outline-level="1"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.15cm" fo:border-bottom="0.5pt solid #${primary}" fo:padding-bottom="0.05cm" fo:keep-with-next="always"/><style:text-properties style:font-name="HeadingFont" fo:font-size="${config.headingSize}pt" fo:font-weight="bold" fo:color="#${primary}"/></style:style>`,
		`<style:style style:name="EntryHeading" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-top="0.15cm" fo:margin-bottom="0.02cm"><style:tab-stops><style:tab-stop style:position="${textWidth.toFixed(3)}cm" style:type="right"/></style:tab-stops></style:paragraph-properties></style:style>`,
		`<style:style style:name="Meta" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.1cm"/><style:text-properties fo:font-style="italic" fo:color="#${textColor}"/></style:style>`,
		`<style:style style:name="Quote" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.5cm" fo:margin-bottom="0.12cm"/><style:text-properties fo:font-style="italic"/></style:style>`,
		`<style:style style:name="CodeBlock" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.12cm"/><style:text-properties style:font-name="CodeFont" fo:font-size="${config.codeSize}pt"/></style:style>`,
		`<style:style style:name="Rule" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.12cm" fo:border-bottom="0.5pt solid #${textColor}" fo:padding="0cm"/></style:style>`,
		`<style:style style:name="ListParagraph" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.05cm"/></style:style>`,
		...Array.from(
			{ length: 8 },
			(_, index) =>
				`<style:style style:name="Indent${index + 1}" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:margin-left="${((index + 1) * 0.5).toFixed(2)}cm"/></style:style>`,
		),
	].join("");

	const textStyles = [
		`<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>`,
		`<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>`,
		`<style:style style:name="Underline" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>`,
		`<style:style style:name="Strike" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>`,
		`<style:style style:name="Link" style:family="text"><style:text-properties fo:color="#${primary}" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>`,
		`<style:style style:name="Code" style:family="text"><style:text-properties style:font-name="CodeFont" fo:font-size="${config.codeSize}pt"/></style:style>`,
	].join("");

	const listStyles = [
		'<text:list-style style:name="BulletList">',
		'<text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.5cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet>',
		'<text:list-level-style-bullet text:level="2" text:bullet-char="◦"><style:list-level-properties text:space-before="1cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet>',
		'<text:list-level-style-bullet text:level="3" text:bullet-char="▪"><style:list-level-properties text:space-before="1.5cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet>',
		"</text:list-style>",
		'<text:list-style style:name="NumberList">',
		'<text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."><style:list-level-properties text:space-before="0.5cm" text:min-label-width="0.4cm"/></text:list-level-style-number>',
		'<text:list-level-style-number text:level="2" style:num-format="a" style:num-suffix="."><style:list-level-properties text:space-before="1cm" text:min-label-width="0.4cm"/></text:list-level-style-number>',
		'<text:list-level-style-number text:level="3" style:num-format="i" style:num-suffix="."><style:list-level-properties text:space-before="1.5cm" text:min-label-width="0.4cm"/></text:list-level-style-number>',
		"</text:list-style>",
	].join("");

	const pageLayout = [
		"<office:automatic-styles>",
		'<style:page-layout style:name="pm1">',
		`<style:page-layout-properties fo:page-width="${page.width}cm" fo:page-height="${page.height}cm" style:print-orientation="portrait" fo:margin-top="${page.marginY}cm" fo:margin-bottom="${page.marginY}cm" fo:margin-left="${page.marginX}cm" fo:margin-right="${page.marginX}cm" style:writing-mode="${page.writingMode}" fo:background-color="#${page.background}"/>`,
		"</style:page-layout>",
		"</office:automatic-styles>",
	].join("");

	return [
		XML_DECLARATION,
		`<office:document-styles ${NS_DECLARATIONS} office:version="1.3">`,
		fontFaceDecls(config.bodyFont, config.headingFont),
		"<office:styles>",
		`<style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2" fo:line-height="${config.lineHeightPercent}%"/><style:text-properties style:font-name="BodyFont" fo:font-size="${config.bodySize}pt" fo:color="#${textColor}"/></style:default-style>`,
		`<style:style style:name="Standard" style:family="paragraph" style:class="text"/>`,
		paragraphStyles,
		textStyles,
		listStyles,
		"</office:styles>",
		pageLayout,
		'<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>',
		"</office:document-styles>",
	].join("");
}

/** Wraps the document body in the `content.xml` envelope. */
function buildContentXml(body: string, automaticStyles: string, config: StyleConfig): string {
	return [
		XML_DECLARATION,
		`<office:document-content ${NS_DECLARATIONS} xmlns:dc="${DC_NS}" office:version="1.3">`,
		fontFaceDecls(config.bodyFont, config.headingFont),
		`<office:automatic-styles>${automaticStyles}</office:automatic-styles>`,
		"<office:body><office:text>",
		body,
		"</office:text></office:body>",
		"</office:document-content>",
	].join("");
}

/** Builds `meta.xml` with the document title and generator metadata. */
function buildMetaXml(title: string): string {
	return [
		XML_DECLARATION,
		`<office:document-meta xmlns:office="${OFFICE_NS}" xmlns:meta="${META_NS}" xmlns:dc="${DC_NS}" office:version="1.3">`,
		`<office:meta><dc:title>${escapeXml(title)}</dc:title><meta:generator>Reactive Resume</meta:generator></office:meta>`,
		"</office:document-meta>",
	].join("");
}

const MANIFEST = [
	XML_DECLARATION,
	`<manifest:manifest xmlns:manifest="${MANIFEST_NS}" manifest:version="1.3">`,
	'<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text" manifest:version="1.3"/>',
	'<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
	'<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>',
	'<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>',
	"</manifest:manifest>",
].join("");

export const ODT_MIME_TYPE = "application/vnd.oasis.opendocument.text";

/**
 * Builds the OpenDocument Text files from resume data, `mimetype` first as ODF requires.
 *
 * Layout is intentionally single-column: the header comes first, then each page's main sections followed by its
 * sidebar ones (full-width pages print no sidebar, as in the PDF). The result is a fully editable ODT document
 * rather than a pixel-perfect reproduction of the template.
 */
export function buildOdtFiles(data: ResumeData, resolveTitle?: SectionTitleResolver): Record<string, string> {
	assertResumeRenderBudget(data);
	const { colors } = data.metadata.design;
	const primary = toHex(colors.primary) ?? "dc2626";
	const textColor = toHex(colors.text) ?? "000000";
	const background = toHex(colors.background) ?? "ffffff";

	const { page, typography } = data.metadata;
	const pageSize = page.format === "letter" ? LETTER_PAGE_SIZE : A4_PAGE_SIZE;
	const bodySize = typography.body.fontSize;
	const headingSize = typography.heading.fontSize;

	const config: StyleConfig = {
		bodySize: round(bodySize),
		headingSize: round(headingSize),
		nameSize: round(headingSize * 1.25),
		codeSize: round(Math.max(bodySize - 1, 7)),
		lineHeightPercent: Math.round(typography.body.lineHeight * 100),
		primary,
		textColor,
		headingFont: typography.heading.fontFamily || "Inter",
		bodyFont: typography.body.fontFamily || "Inter",
	};

	const blocks = isCoverLetterOnlyDocument(data) ? [] : buildHeaderBlocks(data);
	for (const layoutPage of data.metadata.layout.pages) {
		for (const sectionId of [...layoutPage.main, ...(layoutPage.fullWidth ? [] : layoutPage.sidebar)]) {
			blocks.push(...renderSection(sectionId, data, resolveTitle));
		}
	}

	const textStyles = new Map<string, string>();
	const textStyle: TextStyleNamer = (properties) => {
		let name = textStyles.get(properties);
		if (!name) textStyles.set(properties, (name = `T${textStyles.size + 1}`));
		return name;
	};
	const body = blocks.map((block) => serializeBlock(block, textStyle)).join("");
	const automaticStyles = [...textStyles]
		.map(
			([properties, name]) =>
				`<style:style style:name="${name}" style:family="text"><style:text-properties ${properties}/></style:style>`,
		)
		.join("");

	return {
		mimetype: ODT_MIME_TYPE,
		"META-INF/manifest.xml": MANIFEST,
		"content.xml": buildContentXml(body, automaticStyles, config),
		"styles.xml": buildStylesXml(config, {
			width: pageSize.width,
			height: pageSize.height,
			marginX: ptToCm(page.marginX),
			marginY: ptToCm(page.marginY),
			background,
			writingMode: isRTL(page.locale) ? "rl-tb" : "lr-tb",
		}),
		"meta.xml": buildMetaXml(data.basics.name || "Resume"),
	};
}
