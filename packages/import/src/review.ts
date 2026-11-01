import type { CustomSection, ResumeData } from "@reactive-resume/schema/resume/data";
import { generateId } from "@reactive-resume/utils/string";
import { toHtml } from "./html";

/** What an import found, to review before the resume is created. */
export type ImportReview = {
	/** Each section with content, in the resume's order: its key (a built-in name or a custom section's id) and size. */
	sections: { key: string; title: string; entries: number }[];
	/** Lines of the file that nothing in the resume says: what the reader couldn't place. */
	notImported: string[];
	/** No name, email or phone came through: the contact details are probably in a part the reader missed. */
	missingContact: boolean;
};

const normalize = (text: string) =>
	text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/<[^<>]*>/g, " ")
		.replace(/&[a-z]+;|&#\d+;/gi, " ")
		.replace(/[^\p{L}\p{N}@+]+/gu, " ")
		.trim();

/** Every string the resume holds, as one comparable text. */
function resumeText(data: ResumeData) {
	const strings: string[] = [];
	const visit = (value: unknown) => {
		if (typeof value === "string") strings.push(value);
		else if (Array.isArray(value)) value.forEach(visit);
		else if (value && typeof value === "object") Object.values(value).forEach(visit);
	};
	visit([data.basics, data.summary, data.sections, data.customSections]);
	return normalize(strings.join("\n"));
}

const MAX_LEFTOVERS = 40;

/**
 * Lines of the source that the imported resume doesn't hold. A line counts as imported when its text is there, or
 * when most of its words are (the reader may join, split or tidy lines). Headings and other short lines are skipped:
 * what matters is the content under them.
 */
export function notImportedLines(data: ResumeData, lines: readonly string[]) {
	const text = resumeText(data);
	const words = new Set(text.split(" "));
	const leftovers: string[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		const normalized = normalize(line);
		const content = normalized.split(" ").filter((word) => word.length >= 3 && /\p{L}/u.test(word));
		if (content.length < 2 || seen.has(normalized) || text.includes(normalized)) continue;
		const found = content.filter((word) => words.has(word)).length;
		if (found / content.length >= 0.6) continue;
		seen.add(normalized);
		leftovers.push(line.trim());
		if (leftovers.length === MAX_LEFTOVERS) break;
	}
	return leftovers;
}

const hasText = (html: string) => normalize(html).length > 0;

export function reviewImport(data: ResumeData, sourceLines?: readonly string[]): ImportReview {
	const sections: ImportReview["sections"] = [];
	if (hasText(data.summary.content)) sections.push({ key: "summary", title: data.summary.title, entries: 1 });
	for (const [key, section] of Object.entries(data.sections))
		if (section.items.length > 0) sections.push({ key, title: section.title, entries: section.items.length });
	for (const section of data.customSections)
		if (section.items.length > 0)
			sections.push({ key: section.id, title: section.title, entries: section.items.length });

	const { name, email, phone } = data.basics;
	return {
		sections,
		notImported: sourceLines ? notImportedLines(data, sourceLines) : [],
		missingContact: !name.trim() && !email.trim() && !phone.trim(),
	};
}

/** Lines kept as a section of their own at the end of the resume, so the user can sort them in later. */
export function withLeftoverSection(data: ResumeData, lines: readonly string[], title: string): ResumeData {
	if (lines.length === 0) return data;
	const id = generateId();
	const section: CustomSection = {
		id,
		type: "summary",
		title,
		icon: "",
		columns: 1,
		hidden: false,
		showHeading: true,
		keepTogether: false,
		startOnNewPage: false,
		items: [{ id: generateId(), hidden: false, content: toHtml([...lines]) }],
	} as CustomSection;
	const pages = data.metadata.layout.pages.length
		? data.metadata.layout.pages
		: [{ fullWidth: false, main: [], sidebar: [] }];
	const last = pages.length - 1;
	return {
		...data,
		customSections: [...data.customSections, section],
		metadata: {
			...data.metadata,
			layout: {
				...data.metadata.layout,
				pages: pages.map((page, index) => (index === last ? { ...page, main: [...page.main, id] } : page)),
			},
		},
	};
}

// Profiles whose address names their network: "LinkedIn" in the text, linkedin.com behind it.
const NETWORK_HOSTS: Record<string, RegExp> = {
	linkedin: /(^|\.)linkedin\.com$/,
	github: /(^|\.)github\.com$/,
	gitlab: /(^|\.)gitlab\.com$/,
	x: /(^|\.)(x|twitter)\.com$/,
	twitter: /(^|\.)(x|twitter)\.com$/,
	dribbble: /(^|\.)dribbble\.com$/,
	behance: /(^|\.)behance\.net$/,
	medium: /(^|\.)medium\.com$/,
	stackoverflow: /(^|\.)stackoverflow\.com$/,
	instagram: /(^|\.)instagram\.com$/,
	youtube: /(^|\.)youtube\.com$/,
	mastodon: /mastodon|(^|\.)fosstodon\.org$/,
	bluesky: /(^|\.)bsky\.app$/,
};

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
};

function mailAddress(link: string | undefined) {
	const address = link?.replace(/^mailto:/i, "").split("?")[0];
	if (!address) return null;
	try {
		return decodeURIComponent(address);
	} catch {
		return address;
	}
}

/**
 * Link targets a PDF carries behind words like "LinkedIn": a profile with no address gets the link to its network,
 * and an empty email gets the first mail link. Nothing the reader already filled in changes.
 */
export function withLinkTargets(data: ResumeData, links: readonly string[]): ResumeData {
	if (links.length === 0) return data;
	const web = links.filter((link) => /^https?:\/\//i.test(link));
	const used = new Set(data.sections.profiles.items.map((item) => item.website.url).filter(Boolean));
	const items = data.sections.profiles.items.map((item) => {
		if (item.website.url) return item;
		const key = normalize(item.network).replace(/\s+/g, "");
		const pattern = NETWORK_HOSTS[key];
		const url = web.find((link) => {
			if (used.has(link)) return false;
			const host = hostOf(link);
			return !!host && (pattern ? pattern.test(host) : !!key && host.replace(/\./g, "").includes(key));
		});
		if (!url) return item;
		used.add(url);
		return { ...item, website: { ...item.website, url } };
	});
	const mail = mailAddress(links.find((link) => /^mailto:/i.test(link)));
	return {
		...data,
		basics: data.basics.email || !mail ? data.basics : { ...data.basics, email: mail },
		sections: { ...data.sections, profiles: { ...data.sections.profiles, items } },
	};
}
