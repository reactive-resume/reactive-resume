import type { CoverLetter, CoverLetterStyle } from "@reactive-resume/schema/cover-letter/data";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { escapeHtml } from "@reactive-resume/utils/string";

export function copyCoverLetterStyle(
	data: ResumeData,
	sectionId = "library-cover-letter",
	itemId = "library-cover-letter-item",
): CoverLetterStyle {
	const { notes: _notes, layout: _layout, ...metadata } = data.metadata;
	return structuredClone({ basics: data.basics, picture: data.picture, metadata, sectionId, itemId });
}

/** A new letter follows a valid posting language, otherwise its resume or the default style. */
export function initialCoverLetterLocale(
	postingLanguage: string | undefined,
	fallback = defaultResumeData.metadata.page.locale,
): string {
	if (!postingLanguage) return fallback;
	try {
		return Intl.getCanonicalLocales(postingLanguage)[0] ?? fallback;
	} catch {
		return fallback;
	}
}

export function createCoverLetterResumeData(
	letter: Pick<CoverLetter, "name" | "recipient" | "content" | "style">,
): ResumeData {
	const data = structuredClone(defaultResumeData);
	const style = structuredClone(letter.style);
	data.basics = style.basics;
	data.picture = style.picture;
	data.metadata = {
		...style.metadata,
		notes: "",
		layout: { sidebarWidth: 35, pages: [{ fullWidth: true, main: [style.sectionId], sidebar: [] }] },
	};
	data.customSections = [
		{
			id: style.sectionId,
			type: "cover-letter",
			title: letter.name,
			icon: "envelope",
			columns: 1,
			hidden: false,
			keepTogether: false,
			startOnNewPage: false,
			items: [{ id: style.itemId, hidden: false, recipient: letter.recipient, content: letter.content }],
		},
	];
	return data;
}

/** A cover letter written inside a resume, as older versions of the app stored them. */
export type EmbeddedLetter = {
	sectionId: string;
	itemId: string;
	/** The section's title; empty when the template's default title was used. */
	title: string;
	recipient: string;
	content: string;
};

/**
 * Letters are documents of their own; resumes no longer carry them. Takes every cover-letter section out of the
 * resume (and out of its page layout) and returns the letters it held, so the caller can save them as letters.
 * Mutates `data` in place; returns no letters, and changes nothing, for a resume without any.
 */
export function detachEmbeddedLetters(data: ResumeData): EmbeddedLetter[] {
	const sections = data.customSections.filter((section) => section.type === "cover-letter");
	if (sections.length === 0) return [];

	const ids = new Set(sections.map((section) => section.id));
	data.customSections = data.customSections.filter((section) => !ids.has(section.id));
	for (const page of data.metadata.layout.pages) {
		page.main = page.main.filter((id) => !ids.has(id));
		page.sidebar = page.sidebar.filter((id) => !ids.has(id));
	}

	return sections.flatMap((section) =>
		section.items.map((item) => {
			const { recipient, content } = item as { recipient?: unknown; content?: unknown };
			return {
				sectionId: section.id,
				itemId: item.id,
				title: section.title,
				recipient: typeof recipient === "string" ? recipient : "",
				content: typeof content === "string" ? content : "",
			};
		}),
	);
}

export function coverLetterTextToHtml(text: string): string {
	return text
		.trim()
		.split(/\n\s*\n/)
		.filter(Boolean)
		.map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br />")}</p>`)
		.join("");
}

const HONORIFIC = /^(mr|mrs|ms|mx|dr|prof)\.?$/i;

/**
 * Who a structured letter's greeting addresses: a first name ("Dana Reyes" → "Dana"), a title with the surname
 * ("Dr. Dana Reyes" → "Dr. Reyes") or a team as written ("Design team"). Null without a name, or for "Hiring team",
 * which greets the hiring team.
 */
export function greetingName(recipientName: string): string | null {
	const words = recipientName.trim().split(/\s+/).filter(Boolean);
	const [first, ...rest] = words;
	if (!first || words.join(" ").toLowerCase() === "hiring team") return null;
	if (rest.at(-1)?.toLowerCase() === "team") return words.join(" ");
	if (HONORIFIC.test(first) && rest.length > 0) return `${first} ${rest.at(-1)}`;
	return first;
}

/** The words a structured letter is composed with, in the reader's language. */
export type LetterWords = {
	/** "Dear {name}," */
	greeting: (name: string) => string;
	/** "Dear hiring team," */
	teamGreeting: string;
	/** The recipient shown when there's no name: "Hiring team". */
	hiringTeam: string;
	/** "Kind regards," */
	signOff: string;
	/** The letter's date (YYYY-MM-DD) as written on the page. */
	formatDate: (date: string) => string;
};

type ComposableLetter = Pick<
	CoverLetter,
	"layout" | "recipient" | "content" | "recipientName" | "recipientCompany" | "letterDate" | "style"
> &
	Partial<Pick<CoverLetter, "greeting" | "signOff">>;

/** The automatic signature includes the sender; custom signatures replace this whole block. */
export const defaultCoverLetterSignOff = (letter: Pick<CoverLetter, "style">, words: LetterWords) =>
	[words.signOff, letter.style.basics.name.trim()].filter(Boolean).join("\n");

/**
 * A letter's recipient block and body as the page shows them. Structured letters compose the recipient (name or
 * team, company) and the date, then a greeting from the name, the body and a sign-off over the sender's name.
 * Freeform letters read exactly as written.
 */
export function composeCoverLetter(letter: ComposableLetter, words: LetterWords) {
	if (letter.layout === "freeform") return { recipient: letter.recipient, content: letter.content };

	// "Hiring team" stands in for a missing name above a company; with neither, there's no address line at all (the
	// greeting already says "Dear hiring team").
	const addressed = Boolean(letter.recipientName.trim() || letter.recipientCompany.trim());
	const to = addressed
		? [letter.recipientName.trim() || words.hiringTeam, letter.recipientCompany.trim()]
				.filter(Boolean)
				.map(escapeHtml)
				.join("<br />")
		: "";
	const date = letter.letterDate ? `<p>${escapeHtml(words.formatDate(letter.letterDate))}</p>` : "";
	const name = greetingName(letter.recipientName);
	const greeting = letter.greeting ?? (name ? words.greeting(name) : words.teamGreeting);
	const signOff = letter.signOff ?? defaultCoverLetterSignOff(letter, words);

	return {
		recipient: `${to ? `<p>${to}</p>` : ""}${date}`,
		content: [
			greeting.trim() ? coverLetterTextToHtml(greeting) : "",
			letter.content,
			signOff.trim() ? `<p>${escapeHtml(signOff).replaceAll("\n", "<br />")}</p>` : "",
		].join(""),
	};
}
