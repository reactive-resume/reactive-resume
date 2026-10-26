import type { ResumeData } from "@reactive-resume/schema/resume/data";

export type ResumeSocialMeta = { title: string; description: string };

// Social cards truncate around this length; trimming here keeps the ellipsis on a word boundary
// instead of letting the crawler cut mid-word.
const DESCRIPTION_LIMIT = 160;

const truncate = (text: string) => {
	if (text.length <= DESCRIPTION_LIMIT) return text;

	const clipped = text.slice(0, DESCRIPTION_LIMIT);
	const lastSpace = clipped.lastIndexOf(" ");

	return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

/** The title and description a resume's web page gives search engines and link previews. */
export const getResumeSocialMeta = (data: ResumeData): ResumeSocialMeta => {
	const name = data.basics.name || "Resume";
	const summary = data.summary.content
		// `[^<>]` keeps a run of unclosed `<` linear; Tiptap escapes literal brackets, so tags match as before.
		.replace(/<[^<>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	return {
		title: data.basics.headline ? `${name} — ${data.basics.headline}` : name,
		description: truncate(summary || data.basics.headline || name),
	};
};
