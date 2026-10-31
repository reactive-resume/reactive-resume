import { parseDocument } from "htmlparser2";

function richTextReview(html: string): string {
	const links = new Set<string>();
	const read = (node: ReturnType<typeof parseDocument>["children"][number]): string => {
		if (node.type === "text") return node.data;
		if ("attribs" in node && node.name === "a" && node.attribs.href) links.add(node.attribs.href);
		const text = "children" in node ? node.children.map(read).join("") : "";
		return "name" in node && ["p", "li", "div", "blockquote", "br"].includes(node.name) ? `${text}\n` : text;
	};
	const text = parseDocument(html).children.map(read).join("").trim();
	return [text, ...[...links].map((url) => `Link: ${url}`)].join("\n");
}

/** Review authored data, not export layout: levels, styling and parent/role fields must remain visible. */
export function entryReview(entry: Record<string, unknown>): string {
	return Object.entries(entry)
		.flatMap(([field, value]) => {
			if (["id", "hidden"].includes(field)) return [];
			if (value === null || value === undefined || value === "" || (value === false && field !== "present")) return [];
			const label = field
				.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
				.replace(/^./, (letter) => letter.toUpperCase());
			if (Array.isArray(value)) {
				const items = value
					.map((item) =>
						typeof item === "object" && item !== null ? entryReview(item as Record<string, unknown>) : String(item),
					)
					.filter(Boolean);
				return items.length
					? [`${label}:\n${items.map((item) => `  - ${item.replaceAll("\n", "\n    ")}`).join("\n")}`]
					: [];
			}
			if (typeof value === "object") {
				const children = entryReview(value as Record<string, unknown>);
				return children ? [`${label}:\n  ${children.replaceAll("\n", "\n  ")}`] : [];
			}
			const text =
				typeof value === "string" && ["description", "content", "recipient"].includes(field)
					? richTextReview(value)
					: String(value);
			return [`${label}: ${field === "level" ? `${text}/5` : text}`];
		})
		.join("\n");
}
