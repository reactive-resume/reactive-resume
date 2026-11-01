// Formatting a document carries in its own styles, not the resume's: a pasted colour stays black on a dark field and
// overrides the template's text colour in print, and a pasted font or size overrides the template's typography.
const PASTED_STYLE = /^(color|background|background-color|font|font-family|font-size|line-height|mso-.*)$/i;

// Word's list paragraphs: class `MsoListParagraph…`, or `mso-list` in the inline style.
const WORD_LIST = /\bmso-list\s*:\s*l\d/i;
// The marker Word types in front of each item ("·", "o", "§", "1.", "a)") and the non-breaking spaces after it.
const WORD_MARKER = /^\s*(?:[·•o§▪◦\-–]|\(?[0-9a-z]{1,3}[.)])[\s ]+/i;
const ORDERED_MARKER = /^\s*\(?[0-9a-z]{1,3}[.)]/i;

function isWordListItem(element: Element) {
	return (
		element.tagName === "P" &&
		(/\bMsoListParagraph/.test(element.className) || WORD_LIST.test(element.getAttribute("style") ?? ""))
	);
}

// A numbered marker's value: "4." → 4. Letters and roman numerals don't carry a start a list can use.
const markerNumber = (marker: string) => {
	const digits = /^\s*\(?(\d{1,3})[.)]/.exec(marker)?.[1];
	return digits ? Number(digits) : undefined;
};

type WordMarker = { ordered: boolean; number: number | undefined };

/**
 * Drops the marker Word typed in front of a list paragraph and says what it was. Word wraps the marker in an
 * `mso-list:Ignore` span; only without one is a marker read off the text, so an item that begins "- " or "Inc. " keeps
 * its words when Word marked the list itself.
 */
function stripWordMarker(item: Element): WordMarker {
	const result: WordMarker = { ordered: false, number: undefined };
	let spanned = false;
	for (const marker of item.querySelectorAll('[style*="mso-list"]')) {
		if (!/ignore/i.test(marker.getAttribute("style") ?? "")) continue;
		const text = marker.textContent ?? "";
		result.ordered ||= ORDERED_MARKER.test(text);
		result.number ??= markerNumber(text);
		marker.remove();
		spanned = true;
	}
	const walker = item.ownerDocument.createTreeWalker(item, 4 /* NodeFilter.SHOW_TEXT */);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const text = node.textContent ?? "";
		if (!text.trim()) {
			node.textContent = "";
			continue;
		}
		const match = spanned ? null : WORD_MARKER.exec(text);
		if (match) {
			result.ordered ||= ORDERED_MARKER.test(match[0]);
			result.number ??= markerNumber(match[0]);
			node.textContent = text.slice(match[0].length);
		}
		break;
	}
	return result;
}

/** Which Word list a paragraph belongs to (its `lfo` number): a bullet list and a numbered one next to it stay apart. */
const listInstance = (element: Element) => /\blfo(\d+)/i.exec(element.getAttribute("style") ?? "")?.[1];

/** Word's list paragraphs as lists: each run of one list becomes one `<ul>` (or `<ol>`, from its first number). */
function convertWordLists(body: HTMLElement) {
	const document = body.ownerDocument;
	for (const paragraph of body.querySelectorAll("p")) {
		if (!paragraph.isConnected || !isWordListItem(paragraph)) continue;
		const instance = listInstance(paragraph);
		const run: Element[] = [];
		for (
			let item: Element | null = paragraph;
			item && isWordListItem(item) && listInstance(item) === instance;
			item = item.nextElementSibling
		)
			run.push(item);
		const markers = run.map(stripWordMarker);
		const ordered = markers.some((marker) => marker.ordered);
		const list = document.createElement(ordered ? "ol" : "ul");
		const start = markers[0]?.number;
		if (ordered && start !== undefined && start !== 1) list.setAttribute("start", String(start));
		paragraph.before(list);
		for (const item of run) {
			const li = document.createElement("li");
			li.append(...item.childNodes);
			list.append(li);
			item.remove();
		}
	}
}

/**
 * Pasted HTML with the source document's own colours, fonts and sizes taken off, and Word's typed bullets turned into
 * lists. Bold, italic, underline, links and lists stay.
 */
export function cleanPastedHtml(html: string) {
	if (typeof DOMParser === "undefined") return html;
	const document = new DOMParser().parseFromString(html, "text/html");
	const { body } = document;
	convertWordLists(body);
	for (const element of body.querySelectorAll<HTMLElement>("[style]")) {
		const kept = (element.getAttribute("style") ?? "")
			.split(";")
			.map((declaration) => declaration.trim())
			.filter((declaration) => {
				const property = declaration.split(":")[0]?.trim() ?? "";
				return declaration.includes(":") && !PASTED_STYLE.test(property);
			});
		if (kept.length > 0) element.setAttribute("style", kept.join("; "));
		else element.removeAttribute("style");
	}
	for (const font of body.querySelectorAll("font")) font.replaceWith(...font.childNodes);
	for (const element of body.querySelectorAll("[class]")) element.removeAttribute("class");
	return body.innerHTML;
}
