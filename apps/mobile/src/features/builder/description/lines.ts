// A description as editable lines: each <li> or <p> of the rich text is one line. Editing a line keeps it as plain
// text; Bold, Italic and Link wrap the whole line.
// ponytail: inline marks inside a line are dropped once that line is retyped; the rich-text field primitive
// (requested) edits marks within a line.

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
const stripHtml = (html: string) =>
	html.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => entities[name] ?? "");

export type Line = {
	text: string;
	list: boolean;
	/** The line's inner HTML while it still has marks. */ html?: string | undefined;
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function parseLines(html: string): Line[] {
	const lines: Line[] = [];
	const pattern = /<(li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
	for (const match of html.matchAll(pattern)) {
		const inner = match[2] ?? "";
		const text = stripHtml(inner).replace(/\s+/g, " ").trim();
		lines.push({ text, list: match[1]?.toLowerCase() === "li", ...(/<[a-z]/i.test(inner) ? { html: inner } : {}) });
	}
	if (lines.length === 0 && stripHtml(html).trim()) lines.push({ text: stripHtml(html).trim(), list: false });
	return lines;
}

export function serializeLines(lines: readonly Line[]): string {
	let out = "";
	let open = false;
	for (const line of lines) {
		const inner = line.html ?? escape(line.text);
		if (line.list && !open) out += "<ul>";
		if (!line.list && open) out += "</ul>";
		open = line.list;
		out += line.list ? `<li>${inner}</li>` : `<p>${inner}</p>`;
	}
	if (open) out += "</ul>";
	return out;
}

/** Wraps the whole line in <strong> or <em>, or unwraps it when it already is. */
export function toggleWrap(line: Line, tag: "strong" | "em"): string {
	const inner = line.html ?? escape(line.text);
	const wrapped = new RegExp(`^<${tag}>([\\s\\S]*)</${tag}>$`);
	const match = inner.match(wrapped);
	return match ? (match[1] ?? "") : `<${tag}>${inner}</${tag}>`;
}
