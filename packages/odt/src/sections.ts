import type { OdtBlock, OdtInline, SectionTitleResolver } from "./types";
import type { EntryHeader, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { toSafeLink } from "@reactive-resume/utils/link";
import { htmlToOdtBlocks } from "./html-to-odt";
import { paragraph, text } from "./types";

type Sections = ResumeData["sections"];
type ItemOf<T extends SectionType> = Sections[T]["items"][number];

/** `Primary — Secondary`, with an optional right-aligned meta suffix (period, date). */
function entryHeading(primary: string, secondary?: string, meta?: string, bold = true): OdtBlock {
	const children: OdtInline[] = [text(primary, bold ? { bold: true } : {})];
	if (secondary) children.push(text(` — ${secondary}`));
	if (meta) children.push({ type: "tab" }, text(meta, { italic: true }));
	return paragraph(children, "EntryHeading");
}

/** `**Name** — detail: extras`, for the compact sections (skills, languages, profiles, …). */
function labelled(name: string, detail?: string, extras?: string): OdtBlock {
	const children = [text(name, { bold: true })];
	if (detail) children.push(text(` — ${detail}`));
	if (extras) children.push(text(`: ${extras}`));
	return paragraph(children);
}

/** An italic muted line (location, grade), when there is anything to print. */
const meta = (value: string): OdtBlock[] => (value ? [paragraph([text(value)], "Meta")] : []);

/** A website link, labelled with its URL when no label was set; nothing when the URL fails the safe-link check. */
function website({ url, label }: { url: string; label: string }): OdtBlock[] {
	const href = toSafeLink(url);
	return href ? [paragraph([{ type: "link", href, children: [text(label || href)] }])] : [];
}

type Lead = EntryHeader["lead"];

/** Design → Entries → Row order, as the DOCX export reads it: the role first when the resume leads with it. */
const byLead = (lead: Lead, organization: string, role: string): [string, string] =>
	lead === "role" && role.trim() ? [role, organization] : [organization, role];

/** Each built-in item type to its blocks, mirroring the DOCX and Markdown exports. */
const renderItem: { [T in SectionType]: (item: ItemOf<T>, section: Sections[T], lead: Lead) => OdtBlock[] } = {
	experience: (item, _section, lead) => {
		const roles = item.roles.filter((role) => role.position.trim());
		return [
			roles.length > 0
				? entryHeading(item.company, undefined, item.period)
				: entryHeading(...byLead(lead, item.company, item.position), item.period),
			...meta(item.location),
			...roles.flatMap((role) => [entryHeading(role.position, role.period), ...htmlToOdtBlocks(role.description)]),
			...htmlToOdtBlocks(item.description),
			...website(item.website),
		];
	},
	education: (item, _section, lead) => [
		entryHeading(...byLead(lead, item.school, [item.degree, item.area].filter(Boolean).join(", ")), item.period),
		...meta(item.grade ? `Grade: ${item.grade}` : ""),
		...meta(item.location),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	projects: (item) => [
		entryHeading(item.name, undefined, item.period),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	skills: (item, section) => {
		const asList = section.keywordLayout === "list";
		return [
			labelled(item.name, item.proficiency, asList ? undefined : item.keywords.join(", ")),
			...(asList && item.keywords.length > 0
				? [
						{
							type: "list",
							ordered: false,
							items: item.keywords.map((keyword) => ({ blocks: [paragraph([text(keyword)])] })),
						} satisfies OdtBlock,
					]
				: []),
		];
	},
	languages: (item) => [labelled(item.language, item.fluency)],
	interests: (item) => [labelled(item.name, undefined, item.keywords.join(", "))],
	awards: (item) => [
		entryHeading(item.title, item.awarder, item.date, false),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	certifications: (item) => [
		entryHeading(item.title, item.issuer, item.date),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	publications: (item) => [
		entryHeading(item.title, item.publisher, item.date),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	volunteer: (item) => [
		entryHeading(item.organization, undefined, item.period),
		...meta(item.location),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	references: (item) => [
		labelled(item.name, item.position),
		...(item.phone ? [paragraph([text(item.phone)])] : []),
		...htmlToOdtBlocks(item.description),
		...website(item.website),
	],
	profiles: (item) => [labelled(item.network, item.username), ...website(item.website)],
};

type HeadedSection = { title: string; showHeading?: boolean | undefined };

const heading = (section: HeadedSection, title: string): OdtBlock[] =>
	section.showHeading !== false && title ? [{ type: "heading", level: 1, children: [text(title)] }] : [];

/** A built-in-typed section's heading and visible items; nothing when the section or every item is hidden. */
function renderItems<T extends SectionType>(type: T, section: Sections[T], title: string, lead: Lead): OdtBlock[] {
	const items = (section.items as ItemOf<T>[]).filter((item) => !item.hidden);
	if (section.hidden || items.length === 0) return [];
	const render = renderItem[type] as (item: ItemOf<T>, section: Sections[T], lead: Lead) => OdtBlock[];
	return [...heading(section, title), ...items.flatMap((item) => render(item, section, lead))];
}

/** Renders any section id (summary, built-in or custom) under its locale-aware title. */
export function renderSection(sectionId: string, data: ResumeData, resolveTitle?: SectionTitleResolver): OdtBlock[] {
	const titleOf = (stored: string) => resolveTitle?.(sectionId)?.trim() || stored;
	const { lead } = entryHeaderOf(data.metadata.design);

	if (sectionId === "summary") {
		const { summary } = data;
		if (summary.hidden || !summary.content) return [];
		return [...heading(summary, titleOf(summary.title)), ...htmlToOdtBlocks(summary.content)];
	}

	if (sectionId in data.sections) {
		const section = data.sections[sectionId as SectionType];
		return renderItems(sectionId as SectionType, section, titleOf(section.title), lead);
	}

	const custom = data.customSections.find((candidate) => candidate.id === sectionId);
	if (!custom || custom.hidden) return [];

	// Summary and cover-letter sections print their own rich text; a letter prints no heading.
	if (custom.type === "summary" || custom.type === "cover-letter") {
		const blocks = custom.items
			.filter((item) => !item.hidden)
			.flatMap((item) => [
				...("recipient" in item ? htmlToOdtBlocks(item.recipient) : []),
				...("content" in item ? htmlToOdtBlocks(item.content) : []),
			]);
		if (blocks.length === 0) return [];
		return custom.type === "summary" ? [...heading(custom, titleOf(custom.title)), ...blocks] : blocks;
	}

	// Other custom sections share a built-in type's item shape, so they reuse its renderer.
	return renderItems(custom.type, custom as unknown as Sections[SectionType], titleOf(custom.title), lead);
}
