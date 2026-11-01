import { Parser } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

/** Legacy recipient markup becomes display text, never executable markup or encoded entity syntax. */
export function coverLetterRecipientText(html: string): string {
	let text = "";
	let hidden = 0;
	const blocks = new Set(["p", "div", "br", "li", "blockquote", "h1", "h2", "h3", "tr"]);
	new Parser(
		{
			onopentag(name) {
				if (name === "script" || name === "style") hidden++;
				else if (!hidden && blocks.has(name)) text += " ";
			},
			ontext(value) {
				if (!hidden) text += value;
			},
			onclosetag(name) {
				if (name === "script" || name === "style") hidden = Math.max(0, hidden - 1);
				else if (!hidden && blocks.has(name)) text += " ";
			},
		},
		{ decodeEntities: true },
	).end(html);
	return text.replace(/\s+/g, " ").trim();
}

// Match RichInput's formatting surface, without executable markup or CSS URLs.
export function sanitizeCoverLetterHtml(html: string): string {
	return sanitizeHtml(html, {
		allowedTags: [
			"p",
			"br",
			"strong",
			"b",
			"em",
			"i",
			"u",
			"s",
			"strike",
			"ul",
			"ol",
			"li",
			"blockquote",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"hr",
			"span",
			"mark",
			"a",
		],
		allowedAttributes: { "*": ["style"], a: ["href", "title"], ol: ["start"] },
		allowedSchemes: ["http", "https", "mailto", "tel"],
		allowProtocolRelative: false,
		allowedStyles: {
			"*": {
				"text-align": [/^(?:left|right|center|justify)$/],
				color: [/^#[\da-f]{3,8}$/i, /^rgba?\([\d.,\s%]+\)$/i, /^[a-z]+$/i],
				"background-color": [/^#[\da-f]{3,8}$/i, /^rgba?\([\d.,\s%]+\)$/i, /^[a-z]+$/i],
			},
		},
	});
}
