import { validate as isUuid, v5 as uuidv5, v7 as uuidv7 } from "uuid";

/**
 * Generates a unique ID using the UUIDv7 algorithm.
 * @returns The generated ID.
 */
export function generateId() {
	return uuidv7();
}

/** One title rule for optimistic conversation lists and the saved transcript. */
export function buildConversationTitle(input: string, fallback: string, max = 60) {
	const text = input.replace(/\s+/g, " ").trim();
	if (!text) return fallback;
	if (text.length <= max) return text;
	const cut = text.slice(0, max - 1);
	const space = cut.lastIndexOf(" ");
	const bounded = (space > max / 2 ? cut.slice(0, space) : cut).trimEnd();
	return `${bounded.replace(/[\uD800-\uDBFF]$/u, "")}…`;
}

const pendingRequestIds = new Map<string, string>();

type RequestIdStorage = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => unknown;
};

// Persist only an opaque fingerprint and UUID, never the request's private fields.
const pendingRequestKey = (key: string) => `reactive-resume:pending-request:${uuidv5(key, uuidv5.URL)}`;

/**
 * The ID a create request sends, the same one each time until it succeeds: a retry after a lost response, a second
 * press or a remounted screen then returns what the first attempt saved instead of saving it again. `key` names the
 * request by what it saves, so changing the input starts a new one. Call `settleRequestId` once it has succeeded.
 */
export function pendingRequestId(key: string, storage?: RequestIdStorage) {
	const storageKey = storage ? pendingRequestKey(key) : key;
	let id = storage ? storage.getItem(storageKey) : pendingRequestIds.get(key);
	if (storage && id && !isUuid(id)) throw new Error("Invalid pending request ID");
	if (!id) {
		id = generateId();
		if (storage) storage.setItem(storageKey, id);
		else pendingRequestIds.set(key, id);
	}
	return id;
}

export function settleRequestId(key: string, storage?: RequestIdStorage, expectedId?: string) {
	if (storage) {
		const storageKey = pendingRequestKey(key);
		if (expectedId !== undefined && storage.getItem(storageKey) !== expectedId) return;
		storage.removeItem(storageKey);
	} else pendingRequestIds.delete(key);
}

/**
 * Generates initials from a name.
 * @param name - The name to generate initials from.
 * @returns The initials.
 */
// Scripts whose letters join to the next one: two initials side by side would read as a word ("لح").
const JOINING_SCRIPT = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Adlam}]/u;

export function getInitials(name: string) {
	const letters = name
		.split(" ")
		.filter(Boolean)
		.map((part) => [...part][0] ?? "")
		.slice(0, 2);
	// A zero-width non-joiner keeps joining initials apart, as two letters.
	return letters.join(letters.some((letter) => JOINING_SCRIPT.test(letter)) ? "\u200c" : "").toUpperCase();
}

/**
 * Transforms a string to a valid username (lowercase, no special characters except for dots, hyphens and underscores).
 * @param value - The value to transform.
 * @returns The transformed username.
 */
export function toUsername(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]/g, "")
		.slice(0, 64);
}

/**
 * Strips HTML tags from a string and returns the text content.
 * @param html - The HTML string to strip.
 * @returns The text content without HTML tags.
 */
/** Text safe to place inside HTML: markup characters and both quote marks become entities. */
export const escapeHtml = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

/** Lowercase text without accents, for loose matching: "Österreich" becomes "osterreich". */
const fold = (text: string) =>
	text
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase();

/** Match labels and hidden search keywords loosely, or a value exactly, ignoring case and accents. */
export function filterOptions<T extends { value: string; label: string; keywords?: readonly string[] | undefined }>(
	options: readonly T[],
	query: string,
): T[] {
	const needle = fold(query.trim());
	if (!needle) return [...options];
	return options.filter(
		(option) =>
			fold(option.label).includes(needle) ||
			fold(option.value) === needle ||
			option.keywords?.some((keyword) => fold(keyword).includes(needle)),
	);
}

export function stripHtml(html: string | undefined): string {
	if (!html) return "";
	return html.replace(/<[^<>]*>/g, "").trim();
}

/**
 * Shortens a label to an approximate `maxWidth`, where a narrow character counts as one unit and a wide glyph (CJK,
 * Hangul, full-width or emoji) as two. Grapheme clusters stay whole, so an emoji ZWJ sequence or a combining accent is
 * never cut; `Intl.Segmenter` is used when the runtime provides it, with code points as the fallback.
 */
type GraphemeSegmenter = { segment(input: string): Iterable<{ segment: string }> };
const segmenterConstructor = (
	Intl as unknown as {
		Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter;
	}
).Segmenter;
const graphemeSegmenter = (() => {
	if (!segmenterConstructor) return null;
	try {
		return new segmenterConstructor(undefined, { granularity: "grapheme" });
	} catch {
		return null;
	}
})();

/** A small fallback for runtimes without `Intl.Segmenter`: keep combining marks, variation selectors, modifiers and
 * ZWJ sequences attached to their base, so a label never ends on a partial emoji or a stranded accent. */
function fallbackGraphemes(text: string): string[] {
	const parts: string[] = [];
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		const attached =
			(code >= 0x0300 && code <= 0x036f) ||
			(code >= 0x1ab0 && code <= 0x1aff) ||
			(code >= 0x1dc0 && code <= 0x1dff) ||
			(code >= 0x20d0 && code <= 0x20ff) ||
			(code >= 0xfe20 && code <= 0xfe2f) ||
			(code >= 0xfe00 && code <= 0xfe0f) ||
			(code >= 0x1f3fb && code <= 0x1f3ff) ||
			code === 0x200d ||
			code === 0x20e3;
		const previous = parts.at(-1);
		if (previous !== undefined && (attached || previous.endsWith("\u200d"))) {
			parts[parts.length - 1] = previous + character;
		} else {
			parts.push(character);
		}
	}
	return parts;
}

const graphemes = (text: string): string[] =>
	graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), (part) => part.segment) : fallbackGraphemes(text);

/** CJK, Hangul, full-width punctuation and emoji occupy roughly twice the width of a Latin glyph. */
function glyphWidth(grapheme: string): number {
	const code = grapheme.codePointAt(0) ?? 0;
	const wide =
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe4f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1faff) ||
		(code >= 0x20000 && code <= 0x3fffd);
	return wide ? 2 : 1;
}

export function fitLabel(text: string, maxWidth = 18): string {
	if (maxWidth <= 0) return "";
	const parts = graphemes(text);
	if (parts.reduce((total, part) => total + glyphWidth(part), 0) <= maxWidth) return text;
	let width = 0;
	let end = 0;
	while (end < parts.length) {
		const next = glyphWidth(parts[end] ?? "");
		if (width + next > maxWidth - 1) break;
		width += next;
		end++;
	}
	return `${parts.slice(0, end).join("")}…`;
}

/** FNV-1a over the text: a short, stable fingerprint. Not for security. */
export function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
	return hash >>> 0;
}

/** Sentences as written, split after `.`, `!` or `?` and at line breaks. */
const sentencesOf = (text: string) =>
	text
		.split(/(?<=[.!?])\s+|\n+/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);

/**
 * How a rewrite changes a text: words gained (negative when shorter), the original's sentences it changes or drops, and
 * the sentences it brings in. Whole sentences, so the reader can check none of their own is lost.
 */
export function rewriteSummary(before: string, after: string) {
	const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
	const was = sentencesOf(before);
	const now = sentencesOf(after);
	return {
		words: words(after) - words(before),
		removed: was.filter((sentence) => !now.includes(sentence)).length,
		added: now.filter((sentence) => !was.includes(sentence)).length,
	};
}

/**
 * User text inside an interface sentence, isolated (FSI…PDI, the plain-text `<bdi>`): it keeps its own direction, and
 * punctuation around it stays with the sentence, wherever the two scripts differ ("“Lebenslauf (DE)” moved to Trash").
 */
export function isolate(text: string): string {
	return `⁨${text}⁩`;
}
