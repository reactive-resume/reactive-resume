import type { HtmlStyleConfig } from "./html-to-docx";
import type { CustomSection, CustomSectionType, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import { BorderStyle, ExternalHyperlink, HeadingLevel, Paragraph, TabStopPosition, TabStopType, TextRun } from "docx";
import { htmlToParagraphs } from "./html-to-docx";
import { toSafeDocxLink } from "./link-utils";

type Sections = ResumeData["sections"];

/** Module-level typography/color config, set by the builder before rendering. */
let headingFont: string | undefined;
let headingSize: number | undefined;
let bodyFont: string | undefined;
let bodySize: number | undefined;
let textColor: string | undefined;
let primaryColor: string | undefined;

/**
 * Configures the typography and colors used by all section renderers.
 * Must be called before any render functions.
 */
export function setRenderConfig(config: {
	headingFont: string;
	headingSizeHalfPt: number;
	bodyFont: string;
	bodySizeHalfPt: number;
	textColorHex: string;
	primaryColorHex: string;
}): void {
	headingFont = config.headingFont;
	headingSize = config.headingSizeHalfPt;
	bodyFont = config.bodyFont;
	bodySize = config.bodySizeHalfPt;
	textColor = config.textColorHex;
	primaryColor = config.primaryColorHex;
}

function getHtmlStyle(): HtmlStyleConfig {
	return {
		...(bodyFont ? { font: bodyFont } : {}),
		...(bodySize ? { size: bodySize } : {}),
		...(textColor ? { color: textColor } : {}),
		...(primaryColor ? { linkColor: primaryColor } : {}),
	};
}

/** Base TextRun properties (font, size, color) shared across all section renderers. */
function getBaseRun() {
	return {
		...(bodyFont ? { font: bodyFont } : {}),
		...(bodySize ? { size: bodySize } : {}),
		...(textColor ? { color: textColor } : {}),
	};
}

/**
 * Creates a section heading paragraph with primary color and bottom border.
 * Uses the heading typography set via `setRenderConfig`.
 */
function sectionHeading(title: string, colorHex: string): Paragraph {
	// Section headings use <h6> in templates: calc(var(--page-heading-font-size) * 0.75pt)
	const h6Size = headingSize ? Math.round(headingSize * 0.75) : 16;

	return new Paragraph({
		heading: HeadingLevel.HEADING_6,
		spacing: { before: 240, after: 120 },
		border: {
			bottom: { style: BorderStyle.SINGLE, size: 1, color: colorHex.replace("#", "") },
		},
		children: [
			new TextRun({
				text: title,
				bold: true,
				color: colorHex.replace("#", ""),
				size: h6Size,
				...(headingFont ? { font: headingFont } : {}),
			}),
		],
	});
}

function sectionHeadingParagraph<T extends { showHeading?: boolean | undefined }>(
	section: T,
	title: string,
	colorHex: string,
): Paragraph[] {
	return section.showHeading !== false && title ? [sectionHeading(title, colorHex)] : [];
}

function titleAndSubtitle(primary: string, secondary: string, rightText?: string, bold = true): Paragraph {
	const baseRun = getBaseRun();
	const children: (TextRun | ExternalHyperlink)[] = [new TextRun({ text: primary, bold, ...baseRun })];

	if (secondary) {
		children.push(new TextRun({ text: ` — ${secondary}`, ...baseRun }));
	}

	if (rightText) {
		children.push(new TextRun({ text: `\t${rightText}`, italics: true, ...baseRun }));
	}

	return new Paragraph({
		tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
		spacing: { before: 120 },
		children,
	});
}

function locationAndPeriod(location: string, period: string): Paragraph | null {
	const parts = [location, period].filter(Boolean);
	if (parts.length === 0) return null;

	return new Paragraph({
		children: [
			new TextRun({
				text: parts.join(" | "),
				italics: true,
				color: textColor ?? "666666",
				...(bodyFont ? { font: bodyFont } : {}),
				...(bodySize ? { size: bodySize } : {}),
			}),
		],
		spacing: { after: 60 },
	});
}

function websiteParagraph(url: string, label: string): Paragraph | null {
	const safeUrl = toSafeDocxLink(url);
	if (!safeUrl) return null;

	return new Paragraph({
		children: [
			new ExternalHyperlink({
				link: safeUrl,
				children: [
					new TextRun({
						text: label || safeUrl,
						color: primaryColor ?? "0563C1",
						underline: {},
						...(bodyFont ? { font: bodyFont } : {}),
						...(bodySize ? { size: bodySize } : {}),
					}),
				],
			}),
		],
		spacing: { after: 60 },
	});
}

// --- Section-specific renderers ---

export function renderSummary(summary: ResumeData["summary"], colorHex: string): Paragraph[] {
	if (summary.hidden || !summary.content) return [];

	const paragraphs: Paragraph[] = [];
	paragraphs.push(...sectionHeadingParagraph(summary, summary.title, colorHex));
	paragraphs.push(...htmlToParagraphs(summary.content, getHtmlStyle()));
	return paragraphs;
}

function renderExperience(section: Sections["experience"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const roles = item.roles.filter((role) => role.position.trim());
		if (roles.length > 0) {
			paragraphs.push(titleAndSubtitle(item.company, "", item.period));

			const loc = locationAndPeriod(item.location, "");
			if (loc) paragraphs.push(loc);

			for (const role of roles) {
				paragraphs.push(
					new Paragraph({
						spacing: { before: 80 },
						children: [
							new TextRun({ text: role.position, bold: true, italics: true, ...baseRun }),
							...(role.period ? [new TextRun({ text: ` — ${role.period}`, italics: true, ...baseRun })] : []),
						],
					}),
				);
				if (role.description) {
					paragraphs.push(...htmlToParagraphs(role.description, getHtmlStyle()));
				}
			}
		} else {
			paragraphs.push(titleAndSubtitle(item.company, item.position, item.period));

			const loc = locationAndPeriod(item.location, "");
			if (loc) paragraphs.push(loc);
		}
		if (item.description) paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderEducation(section: Sections["education"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const degreeArea = [item.degree, item.area].filter(Boolean).join(", ");
		paragraphs.push(titleAndSubtitle(item.school, degreeArea, item.period));

		if (item.grade) {
			paragraphs.push(
				new Paragraph({
					children: [new TextRun({ text: `Grade: ${item.grade}`, italics: true, ...baseRun })],
				}),
			);
		}

		const loc = locationAndPeriod(item.location, "");
		if (loc) paragraphs.push(loc);

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderProjects(section: Sections["projects"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);

	for (const item of items) {
		paragraphs.push(titleAndSubtitle(item.name, "", item.period));

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderSkills(section: Sections["skills"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const children: TextRun[] = [new TextRun({ text: item.name, bold: true, ...baseRun })];

		if (item.proficiency) {
			children.push(new TextRun({ text: ` — ${item.proficiency}`, ...baseRun }));
		}

		if (section.keywordLayout !== "list" && item.keywords.length > 0) {
			children.push(new TextRun({ text: `: ${item.keywords.join(", ")}`, ...baseRun }));
		}

		paragraphs.push(new Paragraph({ spacing: { before: 60 }, children }));
		if (section.keywordLayout === "list") {
			for (const keyword of item.keywords) {
				paragraphs.push(
					new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: keyword, ...baseRun })] }),
				);
			}
		}
	}

	return paragraphs;
}

function renderLanguages(section: Sections["languages"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const children: TextRun[] = [new TextRun({ text: item.language, bold: true, ...baseRun })];

		if (item.fluency) {
			children.push(new TextRun({ text: ` — ${item.fluency}`, ...baseRun }));
		}

		paragraphs.push(new Paragraph({ spacing: { before: 60 }, children }));
	}

	return paragraphs;
}

function renderInterests(section: Sections["interests"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const children: TextRun[] = [new TextRun({ text: item.name, bold: true, ...baseRun })];

		if (item.keywords.length > 0) {
			children.push(new TextRun({ text: `: ${item.keywords.join(", ")}`, ...baseRun }));
		}

		paragraphs.push(new Paragraph({ spacing: { before: 60 }, children }));
	}

	return paragraphs;
}

function renderAwards(section: Sections["awards"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);

	for (const item of items) {
		paragraphs.push(titleAndSubtitle(item.title, item.awarder, item.date, false));

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderCertifications(section: Sections["certifications"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);

	for (const item of items) {
		paragraphs.push(titleAndSubtitle(item.title, item.issuer, item.date));

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderPublications(section: Sections["publications"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);

	for (const item of items) {
		paragraphs.push(titleAndSubtitle(item.title, item.publisher, item.date));

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderVolunteer(section: Sections["volunteer"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);

	for (const item of items) {
		paragraphs.push(titleAndSubtitle(item.organization, "", item.period));

		const loc = locationAndPeriod(item.location, "");
		if (loc) paragraphs.push(loc);

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderReferences(section: Sections["references"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const children: TextRun[] = [new TextRun({ text: item.name, bold: true, ...baseRun })];

		if (item.position) {
			children.push(new TextRun({ text: ` — ${item.position}`, ...baseRun }));
		}

		paragraphs.push(new Paragraph({ spacing: { before: 120 }, children }));

		if (item.phone) {
			paragraphs.push(
				new Paragraph({
					children: [new TextRun({ text: item.phone, ...baseRun })],
				}),
			);
		}

		if (item.description) {
			paragraphs.push(...htmlToParagraphs(item.description, getHtmlStyle()));
		}

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

function renderProfiles(section: Sections["profiles"], colorHex: string): Paragraph[] {
	const items = section.items.filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];

	const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
	const baseRun = getBaseRun();

	for (const item of items) {
		const children: (TextRun | ExternalHyperlink)[] = [new TextRun({ text: item.network, bold: true, ...baseRun })];

		if (item.username) {
			children.push(new TextRun({ text: ` — ${item.username}`, ...baseRun }));
		}

		paragraphs.push(new Paragraph({ spacing: { before: 60 }, children }));

		const ws = websiteParagraph(item.website.url, item.website.label);
		if (ws) paragraphs.push(ws);
	}

	return paragraphs;
}

/**
 * Mapping from built-in section type to its renderer.
 */
const sectionRenderers: Record<SectionType, (section: Sections[SectionType], colorHex: string) => Paragraph[]> = {
	experience: renderExperience as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	education: renderEducation as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	projects: renderProjects as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	skills: renderSkills as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	languages: renderLanguages as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	interests: renderInterests as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	awards: renderAwards as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	certifications: renderCertifications as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	publications: renderPublications as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	volunteer: renderVolunteer as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	references: renderReferences as (section: Sections[SectionType], colorHex: string) => Paragraph[],
	profiles: renderProfiles as (section: Sections[SectionType], colorHex: string) => Paragraph[],
};

/**
 * Renders a built-in section by type.
 */
export function renderBuiltInSection(type: SectionType, section: Sections[SectionType], colorHex: string): Paragraph[] {
	const renderer = sectionRenderers[type];
	if (!renderer) return [];
	return renderer(section, colorHex);
}

/**
 * Renders a custom section by dispatching to the matching built-in renderer based on its type.
 */
export function renderCustomSection(section: CustomSection, colorHex: string): Paragraph[] {
	if (section.hidden) return [];

	const visibleItems = section.items.filter((item) => !item.hidden);
	if (visibleItems.length === 0) return [];

	const sectionType = section.type as CustomSectionType;

	// Summary-type custom sections render HTML content
	if (sectionType === "summary") {
		const paragraphs: Paragraph[] = sectionHeadingParagraph(section, section.title, colorHex);
		for (const item of visibleItems) {
			if ("content" in item && item.content) {
				paragraphs.push(...htmlToParagraphs(item.content, getHtmlStyle()));
			}
		}
		return paragraphs;
	}

	// Cover letter type — render recipient + content
	if (sectionType === "cover-letter") {
		const paragraphs: Paragraph[] = [];
		for (const item of visibleItems) {
			if ("recipient" in item && item.recipient) {
				paragraphs.push(...htmlToParagraphs(item.recipient, getHtmlStyle()));
			}
			if ("content" in item && item.content) {
				paragraphs.push(...htmlToParagraphs(item.content, getHtmlStyle()));
			}
		}
		return paragraphs;
	}

	// Build a synthetic section matching the built-in type for the renderer
	const sectionKey = sectionType as SectionType;
	if (sectionKey in sectionRenderers) {
		const syntheticSection = {
			...(section.type === "skills" ? { keywordLayout: section.keywordLayout } : {}),
			title: section.title,
			columns: section.columns,
			hidden: false,
			showHeading: section.showHeading,
			items: visibleItems,
		} as Sections[SectionType];

		return renderBuiltInSection(sectionKey, syntheticSection, colorHex);
	}

	return [];
}
