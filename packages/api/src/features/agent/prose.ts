import type { ResumeChange } from "@reactive-resume/resume/structural-proposals";
import { parseDocument } from "htmlparser2";
import { fromMarkdown } from "mdast-util-from-markdown";
import { assertRichTextComplexity } from "@reactive-resume/schema/resume/limits";

const SCOPE_MESSAGE = "Use Add section in Write for a new section, or add an entry in its matching section.";

function assertNoHtmlHeadings(html: string) {
	const nodes = [...parseDocument(html).children];
	while (nodes.length > 0) {
		const node = nodes.pop();
		if (!node) continue;
		if ("name" in node && /^h[1-6]$/.test(node.name)) throw new Error(SCOPE_MESSAGE);
		if ("children" in node) nodes.push(...node.children);
	}
}

/** Parse before flattening: Setext/ATX headings remain headings inside lists and blockquotes. */
function assertProse(text: string, singleBlock = false) {
	if (!text.trim()) return;
	assertRichTextComplexity(text);
	const tree = fromMarkdown(text);
	const nodes = [{ node: tree as typeof tree | (typeof tree.children)[number], inParagraph: false }];
	let paragraphs = 0;
	while (nodes.length > 0) {
		const current = nodes.pop();
		if (!current) continue;
		const { node, inParagraph } = current;
		if (node.type === "heading") throw new Error(SCOPE_MESSAGE);
		// Soft line breaks can carry headingless records; only explicit inline code may span lines.
		if (
			singleBlock &&
			(node.type === "break" || (node.type === "text" && /[\r\n\v\f\u0085\u2028\u2029]/.test(node.value)))
		)
			throw new Error(`Write each paragraph or bullet on one line. ${SCOPE_MESSAGE}`);
		if (node.type === "html") assertNoHtmlHeadings(node.value);
		if (singleBlock && !inParagraph && !["root", "paragraph", "blockquote", "list", "listItem"].includes(node.type))
			throw new Error(`This change can only edit one paragraph or bullet. ${SCOPE_MESSAGE}`);
		if (node.type === "paragraph") paragraphs++;
		if ("children" in node)
			nodes.push(
				...node.children.map((child) => ({ node: child, inParagraph: inParagraph || node.type === "paragraph" })),
			);
	}
	if (singleBlock && paragraphs !== 1)
		throw new Error(`This change can only edit one paragraph or bullet. ${SCOPE_MESSAGE}`);
}

/** Assistant policy stays at the server boundary; Write may author richer resume content. */
export function assertResumeChangeProse(change: ResumeChange) {
	if (change.kind === "text") return assertProse(change.text, true);
	if (change.kind === "field") return;
	const value: unknown = JSON.parse(change.kind === "entry" ? change.entryJson : change.entriesJson);
	const entries = Array.isArray(value) ? [...value] : [value];
	while (entries.length > 0) {
		const entry = entries.pop();
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		for (const field of ["description", "content", "recipient"])
			if (field in entry && typeof (entry as Record<string, unknown>)[field] === "string")
				assertProse((entry as Record<string, string>)[field] ?? "");
		if ("roles" in entry && Array.isArray(entry.roles)) entries.push(...entry.roles);
	}
}
