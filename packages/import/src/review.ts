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

const stringsOf = (value: unknown, into: string[] = []) => {
	if (typeof value === "string") into.push(value);
	else if (Array.isArray(value)) for (const item of value) stringsOf(item, into);
	else if (value && typeof value === "object") for (const item of Object.values(value)) stringsOf(item, into);
	return into;
};

/**
 * The resume's text in the groups a source line would land in: the basics, the summary, and each entry on its own. A
 * line's words and numbers must all be in one group, so a bullet isn't counted as imported because its words turn up
 * scattered across other entries.
 */
function resumeGroups(data: ResumeData) {
	const groups = [normalize(stringsOf(data.basics).join("\n")), normalize(data.summary.content)];
	for (const section of [...Object.values(data.sections), ...data.customSections])
		for (const item of section.items) groups.push(normalize(stringsOf(item).join("\n")));
	return groups.filter(Boolean).map((text) => ({ text, words: new Set(text.split(" ")) }));
}

/**
 * Lines of the source that the imported resume doesn't hold. A line counts as imported when its text is there, or
 * when one entry holds every number in it and most of its words (the reader may join, split or tidy lines, but a lost
 * "18%" is a loss). Headings and other short lines are skipped unless they carry a number the resume lacks, such as
 * a date range: what matters is the content under them.
 */
export function notImportedLines(data: ResumeData, lines: readonly string[]) {
	const groups = resumeGroups(data);
	const all = groups.map((group) => group.text).join("\n");
	const allWords = new Set(all.split(/\s+/));
	const leftovers: string[] = [];
	const seen = new Set<string>();
	for (const line of lines) {
		const normalized = normalize(line);
		const tokens = normalized.split(" ");
		const content = tokens.filter((word) => word.length >= 3 && /\p{L}/u.test(word));
		const numbers = tokens.filter((word) => /\p{N}/u.test(word));
		if (!normalized || seen.has(normalized) || all.includes(normalized)) continue;
		if (content.length < 2 && numbers.every((number) => allWords.has(number))) continue;
		const placed = groups.some(
			(group) =>
				numbers.every((number) => group.words.has(number)) &&
				content.filter((word) => group.words.has(word)).length / Math.max(1, content.length) >= 0.6,
		);
		if (placed) continue;
		seen.add(normalized);
		leftovers.push(line.trim());
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

const pathSegments = (url: string) => {
	try {
		return new URL(url).pathname
			.split("/")
			.filter(Boolean)
			.map((segment) => decodeURIComponent(segment).replace(/^@/, "").toLowerCase());
	} catch {
		return [];
	}
};

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
};

/**
 * Link targets a PDF carries behind words like "LinkedIn": a profile with no address gets the link to its network.
 * Only a link that is clearly that profile's is used: the one link to the network, or the one naming its username.
 * Nothing the reader filled in changes, and mail links aren't used: a referee's address could be the one there.
 */
export function withLinkTargets(data: ResumeData, links: readonly string[]): ResumeData {
	const web = [...new Set(links.filter((link) => /^https?:\/\//i.test(link)))];
	if (web.length === 0) return data;
	const used = new Set(data.sections.profiles.items.map((item) => item.website.url).filter(Boolean));
	const items = data.sections.profiles.items.map((item) => {
		if (item.website.url) return item;
		const key = normalize(item.network).replace(/\s+/g, "");
		const pattern = NETWORK_HOSTS[key];
		const candidates = web.filter((link) => {
			if (used.has(link)) return false;
			const host = hostOf(link);
			return !!host && (pattern ? pattern.test(host) : !!key && host.replace(/\./g, "").includes(key));
		});
		const username = item.username.trim().replace(/^@/, "").toLowerCase();
		// The username is the account's own path segment ("/in/priya-raman", "/@priya"), not any part of the address.
		const named = username ? candidates.filter((link) => pathSegments(link).includes(username)) : [];
		const url = named.length === 1 ? named[0] : !username && candidates.length === 1 ? candidates[0] : undefined;
		if (!url) return item;
		used.add(url);
		return { ...item, website: { ...item.website, url } };
	});
	return { ...data, sections: { ...data.sections, profiles: { ...data.sections.profiles, items } } };
}
