import type { ReactNode } from "react";
import { createElement } from "react";

const TAGS: Record<string, string> = {
	p: "p",
	br: "br",
	ul: "ul",
	ol: "ol",
	li: "li",
	strong: "strong",
	b: "strong",
	em: "em",
	i: "em",
	u: "u",
	s: "s",
	strike: "s",
	del: "s",
	code: "code",
	mark: "mark",
	blockquote: "blockquote",
	h1: "p",
	h2: "p",
	h3: "p",
	h4: "p",
	h5: "p",
	h6: "p",
};

// Their contents are code or markup, not text anyone wrote for the page.
const DROPPED = new Set(["script", "style", "template", "noscript", "iframe", "object"]);

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

function toReact(node: Node, key: number): ReactNode {
	if (node.nodeType === Node.TEXT_NODE) return node.textContent;
	if (node.nodeType !== Node.ELEMENT_NODE) return null;

	const element = node as Element;
	const tag = element.tagName.toLowerCase();
	if (DROPPED.has(tag)) return null;
	const children = Array.from(element.childNodes).map(toReact);

	if (tag === "a") {
		const href = element.getAttribute("href")?.trim() ?? "";
		if (!SAFE_HREF.test(href)) return createElement("span", { key }, ...children);
		return createElement("a", { key, href, target: "_blank", rel: "noopener noreferrer nofollow" }, ...children);
	}

	// Own keys only: an element named after an Object.prototype member (`<constructor>`) must not resolve to it.
	const allowed = Object.hasOwn(TAGS, tag) ? TAGS[tag] : undefined;
	// Anything else (spans, divs, tables, scripts…) keeps only its text.
	if (!allowed) return children.length ? createElement("span", { key }, ...children) : null;
	if (allowed === "br") return createElement("br", { key });
	if (tag.startsWith("h")) return createElement("p", { key }, createElement("strong", null, ...children));
	return createElement(allowed, { key }, ...children);
}

type RichTextProps = { html: string; className?: string };

/**
 * A resume's rich text in the reflowed view. The owner's HTML is never injected: it's parsed, and only formatting tags
 * and plain links become elements, so whatever else it holds stays inert text.
 */
export function RichText({ html, className }: RichTextProps) {
	if (!html.trim()) return null;
	const body = new DOMParser().parseFromString(html, "text/html").body;
	return <div className={className}>{Array.from(body.childNodes).map(toReact)}</div>;
}
