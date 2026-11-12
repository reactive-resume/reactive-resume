// Resume notes are stored as HTML (the web editor's paragraphs); the phone edits them as plain text.

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Paragraphs and line breaks become new lines; other tags are dropped. */
export function notesToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|h[1-6])>\s*/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => entities[name] ?? "")
		.replace(/\n$/, "");
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One paragraph per line, as the web editor writes them. */
export function textToNotes(text: string): string {
	if (!text.trim()) return "";
	return text
		.split("\n")
		.map((line) => `<p>${escape(line)}</p>`)
		.join("");
}
