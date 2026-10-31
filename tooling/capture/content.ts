import { readJobPostingScripts } from "@reactive-resume/import/job-posting";
import { capturePostingUrl, postingCaptureSchema } from "@reactive-resume/schema/applications/capture";

/** Runs only in the extension's isolated world, for the active top-level tab. No page code or credentials are read. */
export function captureDocument(doc: Document, address: string) {
	const text = (html: string) => {
		const template = doc.createElement("template");
		template.innerHTML = html.replace(/<\/(?:p|div|li|h[1-6]|section)>|<br\s*\/?>/gi, "\n");
		template.content
			.querySelectorAll("script,style,noscript,template,input,textarea,select,button,form,nav,footer,aside,[hidden]")
			.forEach((node) => node.remove());
		return template.content.textContent?.trim() ?? "";
	};
	const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
		.slice(0, 20)
		.map((node) => node.textContent ?? "")
		.filter((json) => json.length <= 200_000);
	const page = readJobPostingScripts(scripts, text);
	const selection = doc.getSelection();
	const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
	const sensitive =
		'script,style,noscript,template,input,textarea,select,button,form,nav,footer,aside,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])';
	const selected: string[] = [];
	const summaries = new Map<Element, Element | null>();
	const visit = (node: Node) => {
		if (!range || !range.intersectsNode(node)) return;
		const parent = node.nodeType === 1 ? (node as Element) : node.parentElement;
		if (!parent || parent.closest(sensitive)) return;
		// Inspect the original DOM: cloning loses stylesheet visibility and editable ancestry.
		const view = doc.defaultView;
		if (!view) return;
		for (let element: Element | null = parent; element; element = element.parentElement) {
			const style = view.getComputedStyle(element);
			if (style.display === "none" || style.opacity === "0" || style.contentVisibility === "hidden") return;
			// Closed disclosure bodies can have ordinary computed styles despite not being rendered.
			if (element.matches("details:not([open])") && node !== element) {
				if (!summaries.has(element)) summaries.set(element, element.querySelector(":scope > summary"));
				if (!summaries.get(element)?.contains(parent)) return;
			}
		}
		if (node.nodeType === 3) {
			const style = view.getComputedStyle(parent);
			// A child may explicitly restore visibility or font size inside a hidden ancestor.
			if (["hidden", "collapse"].includes(style.visibility) || Number.parseFloat(style.fontSize) === 0) return;
			const bounds = doc.createRange();
			bounds.selectNodeContents(node);
			if (!bounds.getClientRects().length) return;
			selected.push(
				(node.textContent ?? "").slice(
					range.startContainer === node ? range.startOffset : 0,
					range.endContainer === node ? range.endOffset : undefined,
				),
			);
			return;
		}
		const block = parent.matches("p,div,li,h1,h2,h3,h4,h5,h6,section,br");
		if (block) selected.push("\n");
		for (const child of node.childNodes) visit(child);
		if (block) selected.push("\n");
	};
	if (range && !range.collapsed) visit(range.commonAncestorContainer);
	// No whole-page fallback: navigation, chat, account panels and form fields are outside the posting.
	const description = page?.description || selected.join("").trim();
	return postingCaptureSchema.parse({
		url: capturePostingUrl(address),
		role: (page?.role || doc.title).slice(0, 500),
		company: (page?.company ?? "").slice(0, 500),
		location: (page?.location ?? "").slice(0, 500),
		description: description.slice(0, 20_000),
		truncated: description.length > 20_000,
	});
}
