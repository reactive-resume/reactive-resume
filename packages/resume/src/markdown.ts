import type { CustomSection, CustomSectionType, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import { assertResumeRenderBudget, assertRichTextComplexity } from "@reactive-resume/schema/resume/limits";
import { toSafeLink } from "@reactive-resume/utils/link";
import { isCoverLetterOnlyDocument } from "./export-sections";

type Sections = ResumeData["sections"];

/**
 * Resolves a section's display title from its id. Section titles are stored empty by default and
 * resolved (locale-aware) by the caller — mirroring the PDF/DOCX path — so pass a resolver to get
 * localized headings like "Experience". Without one, the stored (usually empty) title is used.
 */
export type SectionTitleResolver = (sectionId: string) => string | undefined;

/**
 * Serializes resume data to Markdown — a compact, readable format well suited for feeding
 * into AI agents. Scope the input first with `getResumeExportData(data, target)` to emit only
 * the resume or the cover letter.
 */
export function buildMarkdown(data: ResumeData, resolveTitle?: SectionTitleResolver): string {
	assertResumeRenderBudget(data);
	const blocks: string[] = isCoverLetterOnlyDocument(data) ? [] : [...renderHeader(data.basics)];

	for (const page of data.metadata.layout.pages) {
		for (const sectionId of [...page.main, ...page.sidebar]) {
			blocks.push(...renderSection(sectionId, data, resolveTitle));
		}
	}

	// Collapse runs of blank lines and trailing whitespace into a clean document.
	return `${blocks
		.filter(Boolean)
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function renderSection(sectionId: string, data: ResumeData, resolveTitle?: SectionTitleResolver): string[] {
	const titled = <T extends { title: string }>(section: T): T => ({
		...section,
		title: resolveTitle?.(sectionId)?.trim() || section.title,
	});

	if (sectionId === "summary") return renderSummary(titled(data.summary));

	if (sectionId in data.sections) {
		const section = data.sections[sectionId as SectionType];
		return section ? renderBuiltInSection(sectionId as SectionType, titled(section)) : [];
	}

	const customSection = data.customSections.find((cs) => cs.id === sectionId);
	return customSection ? renderCustomSection(titled(customSection)) : [];
}

// --- Header ---

function renderHeader(basics: ResumeData["basics"]): string[] {
	const blocks: string[] = [];
	if (basics.name) blocks.push(`# ${basics.name}`);
	if (basics.headline) blocks.push(`_${basics.headline}_`);

	const contact = [
		basics.email,
		basics.phone,
		basics.location,
		link(basics.website.label || basics.website.url, basics.website.url),
		...basics.customFields.map((field) => (field.link ? link(field.text, field.link) : field.text)),
	].filter(Boolean);

	if (contact.length > 0) blocks.push(contact.join(" · "));
	return blocks;
}

// --- Shared helpers ---

// Like the DOCX, ODT and PDF exports, only web, mail and phone links survive; anything else keeps its label as text.
// The normalized URL has no spaces, and encoded parentheses can't end the Markdown link early.
const markdownHref = (url: string) => toSafeLink(url)?.replaceAll("(", "%28").replaceAll(")", "%29") ?? null;

const link = (label: string, url: string) => {
	const href = url ? markdownHref(url) : null;
	return href ? `[${label || url}](${href})` : label;
};

const heading = (title: string) => (title ? `## ${title}` : "");

/** `### Primary — Secondary` with an optional right-aligned meta suffix in parentheses. */
function entryHeading(primary: string, secondary?: string, meta?: string): string {
	let line = `### ${primary}`;
	if (secondary) line += ` — ${secondary}`;
	if (meta) line += ` (${meta})`;
	return line;
}

const italicLine = (parts: (string | undefined)[]) => {
	const text = parts.filter(Boolean).join(" · ");
	return text ? `_${text}_` : "";
};

function visibleItems<T extends { hidden: boolean }>(section: { hidden: boolean; items: T[] }): T[] {
	if (section.hidden) return [];
	return section.items.filter((item) => !item.hidden);
}

// --- Section renderers ---

function renderSummary(summary: ResumeData["summary"]): string[] {
	if (summary.hidden || !summary.content) return [];
	return [heading(summary.title), htmlToMarkdown(summary.content)].filter(Boolean);
}

function renderExperience(section: Sections["experience"]): string[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const blocks: string[] = [heading(section.title)];
	for (const item of items) {
		const roles = item.roles.filter((role) => role.position.trim());
		if (roles.length > 0) {
			blocks.push(entryHeading(item.company, undefined, item.period), italicLine([item.location]));
			for (const role of roles) {
				blocks.push(italicLine([role.position, role.period]), htmlToMarkdown(role.description));
			}
		} else {
			blocks.push(entryHeading(item.company, item.position, item.period), italicLine([item.location]));
		}
		blocks.push(htmlToMarkdown(item.description));
		blocks.push(link(item.website.label, item.website.url));
	}
	return blocks.filter(Boolean);
}

function renderEducation(section: Sections["education"]): string[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const blocks: string[] = [heading(section.title)];
	for (const item of items) {
		const degreeArea = [item.degree, item.area].filter(Boolean).join(", ");
		blocks.push(entryHeading(item.school, degreeArea, item.period));
		blocks.push(italicLine([item.location, item.grade ? `Grade: ${item.grade}` : ""]));
		blocks.push(htmlToMarkdown(item.description), link(item.website.label, item.website.url));
	}
	return blocks.filter(Boolean);
}

function renderProjects(section: Sections["projects"]): string[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const blocks: string[] = [heading(section.title)];
	for (const item of items) {
		blocks.push(entryHeading(item.name, undefined, item.period));
		blocks.push(htmlToMarkdown(item.description), link(item.website.label, item.website.url));
	}
	return blocks.filter(Boolean);
}

/** Experience-shaped entries with a title, an issuer/subtitle, a date, and rich-text description. */
function renderDatedEntries(
	section: { hidden: boolean; title: string; items: { hidden: boolean }[] },
	map: (item: never) => {
		title: string;
		subtitle?: string;
		date?: string;
		description: string;
		website: ResumeData["basics"]["website"];
	},
): string[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const blocks: string[] = [heading(section.title)];
	for (const item of items) {
		const entry = map(item as never);
		blocks.push(entryHeading(entry.title, entry.subtitle, entry.date));
		blocks.push(htmlToMarkdown(entry.description), link(entry.website.label, entry.website.url));
	}
	return blocks.filter(Boolean);
}

/** Compact one-line entries: `- **Label** — detail: keywords`. */
function renderList(
	section: { hidden: boolean; title: string; items: { hidden: boolean }[] },
	map: (item: never) => {
		label: string;
		detail?: string;
		keywords?: string[];
		website?: ResumeData["basics"]["website"];
	},
): string[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const lines: string[] = [];
	for (const item of items) {
		const entry = map(item as never);
		let line = `- **${entry.label}**`;
		if (entry.detail) line += ` — ${entry.detail}`;
		if (entry.keywords && entry.keywords.length > 0) line += `: ${entry.keywords.join(", ")}`;
		if (entry.website?.url) line += ` (${link(entry.website.label || entry.website.url, entry.website.url)})`;
		lines.push(line);
	}
	return [heading(section.title), lines.join("\n")].filter(Boolean);
}

const sectionRenderers: Record<SectionType, (section: Sections[SectionType]) => string[]> = {
	experience: renderExperience as (s: Sections[SectionType]) => string[],
	education: renderEducation as (s: Sections[SectionType]) => string[],
	projects: renderProjects as (s: Sections[SectionType]) => string[],
	skills: (s) =>
		renderList(s as Sections["skills"], (item: Sections["skills"]["items"][number]) => ({
			label: item.name,
			detail: item.proficiency,
			keywords: item.keywords,
		})),
	languages: (s) =>
		renderList(s as Sections["languages"], (item: Sections["languages"]["items"][number]) => ({
			label: item.language,
			detail: item.fluency,
		})),
	interests: (s) =>
		renderList(s as Sections["interests"], (item: Sections["interests"]["items"][number]) => ({
			label: item.name,
			keywords: item.keywords,
		})),
	profiles: (s) =>
		renderList(s as Sections["profiles"], (item: Sections["profiles"]["items"][number]) => ({
			label: item.network,
			detail: item.username,
			website: item.website,
		})),
	references: (s) =>
		renderList(s as Sections["references"], (item: Sections["references"]["items"][number]) => ({
			label: item.name,
			detail: [item.position, item.phone].filter(Boolean).join(" · "),
			website: item.website,
		})),
	awards: (s) =>
		renderDatedEntries(s as Sections["awards"], (item: Sections["awards"]["items"][number]) => ({
			title: item.title,
			subtitle: item.awarder,
			date: item.date,
			description: item.description,
			website: item.website,
		})),
	certifications: (s) =>
		renderDatedEntries(s as Sections["certifications"], (item: Sections["certifications"]["items"][number]) => ({
			title: item.title,
			subtitle: item.issuer,
			date: item.date,
			description: item.description,
			website: item.website,
		})),
	publications: (s) =>
		renderDatedEntries(s as Sections["publications"], (item: Sections["publications"]["items"][number]) => ({
			title: item.title,
			subtitle: item.publisher,
			date: item.date,
			description: item.description,
			website: item.website,
		})),
	volunteer: (s) =>
		renderDatedEntries(s as Sections["volunteer"], (item: Sections["volunteer"]["items"][number]) => ({
			title: item.organization,
			date: item.period,
			description: item.description,
			website: item.website,
		})),
};

function renderBuiltInSection(type: SectionType, section: Sections[SectionType]): string[] {
	return sectionRenderers[type]?.(section) ?? [];
}

function renderCustomSection(section: CustomSection): string[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const sectionType = section.type as CustomSectionType;

	if (sectionType === "summary") {
		const blocks = [heading(section.title)];
		for (const item of items) if ("content" in item && item.content) blocks.push(htmlToMarkdown(item.content));
		return blocks.filter(Boolean);
	}

	if (sectionType === "cover-letter") {
		const blocks: string[] = [];
		for (const item of items) {
			if ("recipient" in item && item.recipient) blocks.push(htmlToMarkdown(item.recipient));
			if ("content" in item && item.content) blocks.push(htmlToMarkdown(item.content));
		}
		return blocks.filter(Boolean);
	}

	if (sectionType in sectionRenderers) {
		const synthetic = { title: section.title, hidden: false, columns: section.columns, items } as Sections[SectionType];
		return renderBuiltInSection(sectionType as SectionType, synthetic);
	}

	return [];
}

// --- Rich text (tiptap HTML) → Markdown ---

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&nbsp;": " ",
};

/**
 * shortcut: converts the supported formatting tags and flattens others; use a parser if full HTML fidelity is needed.
 */
export function htmlToMarkdown(html: string): string {
	if (!html) return "";
	assertRichTextComplexity(html);
	return convertHtml(html, { remaining: 2_000_000 });
}

function convertHtml(html: string, budget: { remaining: number }): string {
	const charge = (text: string) => {
		budget.remaining -= text.length;
		if (text.length > 200_000 || budget.remaining < 0) throw new Error("Rich text is too complex to convert.");
		return text;
	};
	charge(html);

	// Convert innermost lists first so nested items retain their own numbering and indentation.
	const list = /<(ul|ol)\b([^<>]*)>((?:(?!<(?:ul|ol)\b).)*?)<\/\1>/gis;
	let content = html;
	while (/<(?:ul|ol)\b/i.test(content)) {
		charge(content);
		const next = content.replace(list, (_match, tag: string, attributes: string, inner: string) => {
			let index = Number(/\bstart=["']?(\d+)/i.exec(attributes)?.[1] ?? 1);
			const items = inner.replace(/<li\b[^<>]*>((?:(?!<li\b)[\s\S])*?)<\/li>/gi, (_item, body: string) => {
				const prefix = tag.toLowerCase() === "ol" ? `${index++}. ` : "- ";
				return charge(`${prefix}${convertHtml(body, budget).replace(/\n/g, `\n${" ".repeat(prefix.length)}`)}\n`);
			});
			return `\n${items}\n`;
		});
		if (next === content) break;
		content = charge(next);
	}
	// Each element pattern stops at the next opening of the same tag, so unclosed tags can't make it rescan the rest
	// of the text (quadratic time on crafted input).
	return charge(
		content
			.replace(/<a\b[^<>]*href="([^"<>]*)"[^<>]*>((?:(?!<a\b)[\s\S])*?)<\/a>/gi, (_m, url: string, inner: string) => {
				const href = markdownHref(url);
				return href ? `[${convertHtml(inner, budget)}](${href})` : convertHtml(inner, budget);
			})
			.replace(/<(strong|b)>((?:(?!<\1>)[\s\S])*?)<\/\1>/gi, "**$2**")
			.replace(/<(em|i)>((?:(?!<\1>)[\s\S])*?)<\/\1>/gi, "_$2_")
			.replace(/<(s|strike|del)\b[^<>]*>((?:(?!<\1\b)[\s\S])*?)<\/\1>/gi, "~~$2~~")
			.replace(/<u\b[^<>]*>((?:(?!<u\b)[\s\S])*?)<\/u>/gi, "<u>$1</u>")
			.replace(/<li\b[^<>]*>((?:(?!<li\b)[\s\S])*?)<\/li>/gi, (_m, inner) => `- ${convertHtml(inner, budget).trim()}\n`)
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, "\n\n")
			.replace(/<(?!\/?u>)[^<>]+>/g, "")
			.replace(/&#39;|&nbsp;|&quot;|&amp;|&lt;|&gt;/g, (m) => ENTITIES[m] ?? m)
			.replace(/(?<![ \t])[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);
}
