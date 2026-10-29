import type { LayoutPage, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import {
	BorderStyle,
	convertMillimetersToTwip,
	Document,
	ExternalHyperlink,
	HeadingLevel,
	Paragraph,
	ShadingType,
	Table,
	TableCell,
	TableRow,
	TextRun,
	WidthType,
} from "docx";
import { isCoverLetterOnlyDocument } from "@reactive-resume/resume/export-sections";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { assertResumeRenderBudget } from "@reactive-resume/schema/resume/limits";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { parseColorString } from "@reactive-resume/utils/color";
import { toSafeLink } from "@reactive-resume/utils/link";
import { isRTL } from "@reactive-resume/utils/locale";
import { renderBuiltInSection, renderCustomSection, renderSummary, setRenderConfig } from "./section-renderers";

// --- Color helpers ---

function rgbToHex(r: number, g: number, b: number): string {
	return [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
}

function getColorHex(rgba: string, fallback: string): string {
	const parsed = parseColorString(rgba);
	if (!parsed) return fallback;
	return rgbToHex(parsed.r, parsed.g, parsed.b);
}

// --- Unit conversion helpers ---

/** Convert pt font size to docx half-points (docx uses half-pt units). */
function ptToHalfPt(pt: number): number {
	return Math.round(pt * 2);
}

/** Convert pt spacing to twips (1pt = 20 twips). */
function ptToTwips(pt: number): number {
	return Math.round(pt * 20);
}

// DOCX has fixed pages; free-form resumes intentionally fall back to A4.
const A4_PAGE_SIZE = { width: 210, height: 297 };
const LETTER_PAGE_SIZE = { width: 215.9, height: 279.4 };

// --- Invisible border preset for table cells ---

const NO_BORDERS = {
	top: { style: BorderStyle.NONE, size: 0 },
	bottom: { style: BorderStyle.NONE, size: 0 },
	left: { style: BorderStyle.NONE, size: 0 },
	right: { style: BorderStyle.NONE, size: 0 },
} as const;

// Sidebar and header placement come from `templateLayouts`, as in the PDF; only the sidebar's background is DOCX's
// own: "solid" fills it with the primary colour (text inverts), "tint" with 20% of it.
const SIDEBAR_BACKGROUND: Partial<Record<Template, "solid" | "tint">> = {
	chikorita: "solid",
	ditgar: "tint",
	gengar: "tint",
	glalie: "tint",
};

type PagePlan = { kind: "single"; sections: string[] } | { kind: "split" };

/**
 * How a layout page prints, as in the PDF: a full-width page prints no sidebar, a one-column template prints its
 * sidebar sections after the main ones, and only a two-column template with sidebar sections splits the page.
 */
export function planPageColumns(page: LayoutPage, template: Template): PagePlan {
	const sidebar = page.fullWidth ? [] : page.sidebar;
	if (templateLayouts[template].columns === 1 || sidebar.length === 0) {
		return { kind: "single", sections: [...page.main, ...sidebar] };
	}
	return { kind: "split" };
}

/**
 * Blends a hex color toward white at the given opacity (0-1).
 * Used to approximate CSS `background-color: rgba(r,g,b, 0.2)` on a white background.
 */
function blendWithWhite(hex: string, opacity: number): string {
	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);
	const blend = (c: number) => Math.round(c * opacity + 255 * (1 - opacity));
	return [blend(r), blend(g), blend(b)].map((c) => c.toString(16).padStart(2, "0")).join("");
}

// --- Section rendering dispatch ---

/** Resolves a section's (usually empty) stored title from its id — locale-aware, supplied by the caller. */
export type SectionTitleResolver = (sectionId: string) => string | undefined;

export type DocxRenderOptions = { includeCoverLetterHeader?: boolean };

function renderSection(
	sectionId: string,
	data: ResumeData,
	colorHex: string,
	resolveTitle?: SectionTitleResolver,
): Paragraph[] {
	const titled = <T extends { title: string }>(section: T): T => ({
		...section,
		title: resolveTitle?.(sectionId)?.trim() || section.title,
	});

	if (sectionId === "summary") {
		return renderSummary(titled(data.summary), colorHex);
	}

	// ponytail: data.sections keys are the source of truth; no need to maintain a parallel Set
	if (sectionId in data.sections) {
		const section = data.sections[sectionId as SectionType];
		if (section) {
			return renderBuiltInSection(sectionId as SectionType, titled(section), colorHex);
		}
		return [];
	}

	const customSection = data.customSections.find((cs) => cs.id === sectionId);
	if (customSection) {
		return renderCustomSection(titled(customSection), colorHex);
	}

	return [];
}

// --- Header ---

function buildHeader(data: ResumeData, colorHex: string, textColorHex: string): Paragraph[] {
	const paragraphs: Paragraph[] = [];
	const { basics } = data;
	const headingFont = data.metadata.typography.heading.fontFamily || "Calibri";
	const bodyFont = data.metadata.typography.body.fontFamily || "Calibri";
	// h2 = calc(var(--page-heading-font-size) * 1.25pt)
	const nameSize = ptToHalfPt(data.metadata.typography.heading.fontSize * 1.25);
	const bodySize = ptToHalfPt(data.metadata.typography.body.fontSize);

	if (basics.name) {
		paragraphs.push(
			new Paragraph({
				heading: HeadingLevel.TITLE,
				spacing: { after: 60 },
				children: [
					new TextRun({
						text: basics.name,
						bold: true,
						size: nameSize,
						font: headingFont,
						color: colorHex,
					}),
				],
			}),
		);
	}

	if (basics.headline) {
		paragraphs.push(
			new Paragraph({
				spacing: { after: 60 },
				children: [
					new TextRun({
						text: basics.headline,
						italics: true,
						size: bodySize,
						font: bodyFont,
						color: textColorHex,
					}),
				],
			}),
		);
	}

	const contactParts: (TextRun | ExternalHyperlink)[] = [];
	const plain = (text: string) => new TextRun({ text, size: bodySize, font: bodyFont, color: textColorHex });
	const linked = (text: string, link: string) =>
		new ExternalHyperlink({
			link,
			children: [new TextRun({ text, color: colorHex, underline: {}, size: bodySize, font: bodyFont })],
		});
	const add = (part: TextRun | ExternalHyperlink) => {
		if (contactParts.length > 0) {
			contactParts.push(new TextRun({ text: "  |  ", color: "999999", size: bodySize, font: bodyFont }));
		}
		contactParts.push(part);
	};

	// Email and website entries with an unsafe link are dropped entirely; custom fields fall back to plain text.
	const mailtoLink = basics.email && toSafeLink(`mailto:${basics.email}`);
	if (mailtoLink) add(linked(basics.email, mailtoLink));
	if (basics.phone) add(plain(basics.phone));
	if (basics.location) add(plain(basics.location));
	const websiteLink = basics.website.url && toSafeLink(basics.website.url);
	if (websiteLink) add(linked(basics.website.label || websiteLink, websiteLink));

	for (const field of basics.customFields) {
		if (!field.text) continue;
		const customLink = field.link && toSafeLink(field.link);
		add(customLink ? linked(field.text, customLink) : plain(field.text));
	}

	if (contactParts.length > 0) {
		paragraphs.push(
			new Paragraph({
				spacing: { after: 200 },
				children: contactParts,
			}),
		);
	}

	return paragraphs;
}

// --- Two-column table layout ---

function buildTwoColumnTable(
	mainParagraphs: Paragraph[],
	sidebarParagraphs: Paragraph[],
	sidebarWidthPct: number,
	gapXTwips: number,
	sidebarSide: "left" | "right",
	sidebarShadingHex?: string,
): Table {
	const mainWidthPct = 100 - sidebarWidthPct;

	// DOCX table cells require at least one child
	const mainChildren = mainParagraphs.length > 0 ? mainParagraphs : [new Paragraph({})];
	const sidebarChildren = sidebarParagraphs.length > 0 ? sidebarParagraphs : [new Paragraph({})];

	const sidebarShading = sidebarShadingHex
		? { fill: sidebarShadingHex, type: ShadingType.CLEAR, color: "auto" }
		: undefined;

	const margins: { right?: number; left?: number } = {};

	if (sidebarSide === "left") margins.right = gapXTwips;
	else margins.left = gapXTwips;

	const sidebarCell = new TableCell({
		width: { size: sidebarWidthPct, type: WidthType.PERCENTAGE },
		borders: NO_BORDERS,
		margins,
		children: sidebarChildren,
		...(sidebarShading ? { shading: sidebarShading } : {}),
	});

	const mainCell = new TableCell({
		width: { size: mainWidthPct, type: WidthType.PERCENTAGE },
		borders: NO_BORDERS,
		margins,
		children: mainChildren,
	});

	const cells = sidebarSide === "left" ? [sidebarCell, mainCell] : [mainCell, sidebarCell];

	return new Table({
		rows: [new TableRow({ children: cells })],
		width: { size: 100, type: WidthType.PERCENTAGE },
		borders: {
			...NO_BORDERS,
			insideHorizontal: { style: BorderStyle.NONE, size: 0 },
			insideVertical: { style: BorderStyle.NONE, size: 0 },
		},
	});
}

/**
 * Builds a complete docx Document from resume data.
 *
 * Mirrors the resume builder's visual layout:
 * - Header with name, headline, and contact info (centered, full-width)
 * - Two-column table layout (main + sidebar) matching `metadata.layout`
 * - Typography (font family, size, line height) from `metadata.typography`
 * - Page margins and fixed DOCX page format from `metadata.page`; free-form exports as A4
 * - Primary, text, and background colors from `metadata.design.colors`
 */
export function buildDocument(
	data: ResumeData,
	resolveTitle?: SectionTitleResolver,
	options: DocxRenderOptions = {},
): Document {
	assertResumeRenderBudget(data);
	const colorHex = getColorHex(data.metadata.design.colors.primary, "DC2626");
	const textColorHex = getColorHex(data.metadata.design.colors.text, "000000");
	const bgColorHex = getColorHex(data.metadata.design.colors.background, "FFFFFF");

	const bodyFont = data.metadata.typography.body.fontFamily || "Calibri";
	const bodySize = ptToHalfPt(data.metadata.typography.body.fontSize);
	const lineSpacing = Math.round(data.metadata.typography.body.lineHeight * 240);

	const { page } = data.metadata;
	const pageSize = page.format === "letter" ? LETTER_PAGE_SIZE : A4_PAGE_SIZE;
	// Margins and gaps are defined in points (pt), not mm
	const marginXTwips = ptToTwips(page.marginX);
	const marginYTwips = ptToTwips(page.marginY);
	const gapXTwips = ptToTwips(page.gapX);

	const sidebarWidth = data.metadata.layout.sidebarWidth;

	const layout = templateLayouts[data.metadata.template];
	const background = SIDEBAR_BACKGROUND[data.metadata.template];
	const sidebarShadingHex =
		background === "solid" ? colorHex : background === "tint" ? blendWithWhite(colorHex, 0.2) : undefined;
	// Text on a solid sidebar inverts.
	const sidebarTextColorHex = background === "solid" ? bgColorHex : textColorHex;
	const sidebarHeadingColorHex = background === "solid" ? bgColorHex : colorHex;

	// Configure heading typography for section renderers
	const headingFont = data.metadata.typography.heading.fontFamily || "Calibri";
	const headingSize = ptToHalfPt(data.metadata.typography.heading.fontSize);

	const documentChildren: (Paragraph | Table)[] = [];

	// ponytail: hoisted once; sidebar call spreads only the two differing color keys
	const mainConfig = {
		headingFont,
		headingSizeHalfPt: headingSize,
		bodyFont,
		bodySizeHalfPt: bodySize,
		textColorHex,
		primaryColorHex: colorHex,
		// Only the row order carries over: header layouts and accents don't apply to DOCX (plain, ATS-first).
		lead: entryHeaderOf(data.metadata.design).lead,
	};
	const showHeader = options.includeCoverLetterHeader || !isCoverLetterOnlyDocument(data);
	// Standalone letters use full-width pages even when their resume template puts the header in a column.
	const headerPlacement = options.includeCoverLetterHeader ? "full-width" : layout.headerPlacement;

	// Header placement depends on template
	if (headerPlacement === "full-width" && showHeader) {
		setRenderConfig(mainConfig);
		documentChildren.push(...buildHeader(data, colorHex, textColorHex));
	}

	// Process each page in the layout
	for (const layoutPage of data.metadata.layout.pages) {
		const plan = planPageColumns(layoutPage, data.metadata.template);

		if (plan.kind === "single") {
			setRenderConfig(mainConfig);
			for (const sectionId of plan.sections) {
				documentChildren.push(...renderSection(sectionId, data, colorHex, resolveTitle));
			}
		} else {
			// Render main sections with normal colors
			setRenderConfig(mainConfig);

			const mainParagraphs: Paragraph[] = [];
			if (headerPlacement === "main-only" && showHeader) {
				mainParagraphs.push(...buildHeader(data, colorHex, textColorHex));
			}
			for (const sectionId of layoutPage.main) {
				mainParagraphs.push(...renderSection(sectionId, data, colorHex, resolveTitle));
			}

			// Render sidebar sections with potentially inverted colors
			setRenderConfig({ ...mainConfig, textColorHex: sidebarTextColorHex, primaryColorHex: sidebarHeadingColorHex });

			const sidebarParagraphs: Paragraph[] = [];
			if (headerPlacement === "sidebar-only" && showHeader) {
				sidebarParagraphs.push(...buildHeader(data, sidebarHeadingColorHex, sidebarTextColorHex));
			}
			for (const sectionId of layoutPage.sidebar) {
				sidebarParagraphs.push(...renderSection(sectionId, data, sidebarHeadingColorHex, resolveTitle));
			}

			if (mainParagraphs.length > 0 || sidebarParagraphs.length > 0) {
				documentChildren.push(
					buildTwoColumnTable(
						mainParagraphs,
						sidebarParagraphs,
						sidebarWidth,
						gapXTwips,
						// The side chosen in Design, else the template's own.
						data.metadata.layout.sidebarSide ?? layout.sidebarSide ?? "left",
						sidebarShadingHex,
					),
				);
			}
		}
	}

	return new Document({
		styles: {
			default: {
				document: {
					run: {
						font: bodyFont,
						size: bodySize,
						color: textColorHex,
					},
					paragraph: {
						spacing: { line: lineSpacing },
						...(isRTL(page.locale) ? { bidirectional: true } : {}),
					},
				},
			},
		},
		...(bgColorHex !== "FFFFFF" ? { background: { color: bgColorHex } } : {}),
		sections: [
			{
				properties: {
					page: {
						size: {
							width: convertMillimetersToTwip(pageSize.width),
							height: convertMillimetersToTwip(pageSize.height),
						},
						margin: {
							top: marginYTwips,
							bottom: marginYTwips,
							left: marginXTwips,
							right: marginXTwips,
						},
					},
				},
				children: documentChildren,
			},
		],
	});
}
