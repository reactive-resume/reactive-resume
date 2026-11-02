import type { ContactEntities, ExtractedDocument, RawExtraction, TextLine } from "../types";

// Each pattern starts only where its leading run starts (the lookbehinds), so a long run with no
// match is scanned once rather than once per character.
const EMAIL_PATTERN = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Same shape without `g`: a stateful `lastIndex` would make `.test()` alternate between calls. */
const EMAIL_TEST = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
/** Seven to fifteen digits, the ITU range, with the separators people actually type. */
const PHONE_PATTERN = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.()-]{5,17}\d/g;
const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
/** The lookbehind skips starts an earlier start in the same dotted run already covered. */
const BARE_DOMAIN_PATTERN =
	/\b(?<!\w-*\.?)(?:[\w-]+\.)+(?:com|org|net|io|dev|me|co|ai|app|xyz|edu|gov)(?:\/[^\s<>"')\]]*)?/gi;

const PROFESSIONAL_HOSTS = ["linkedin.com", "github.com", "gitlab.com", "behance.net", "dribbble.com", "medium.com"];

/** Lines this far down page one are past where a parser expects contact details. */
const FIRST_PAGE_CONTACT_LINES = 12;
const MAX_NAME_WORDS = 5;

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function digitsIn(value: string): number {
	return (value.match(/\d/g) ?? []).length;
}

function extractPhones(text: string): string[] {
	const candidates = text.split(/\r?\n/).flatMap((line) => line.match(PHONE_PATTERN) ?? []);

	return uniqueStrings(
		candidates
			.map((candidate) => candidate.trim())
			.filter((candidate) => {
				const digits = digitsIn(candidate);
				if (digits < 7 || digits > 15) return false;
				if (/^(?:19|20)\d{2}\s*[-–—]?\s*(?:19|20)\d{2}$/.test(candidate)) return false;
				// A year range or a street number is digits too; a phone number is mostly digits.
				return digits / candidate.replace(/\s/g, "").length > 0.55;
			}),
	);
}

function hostOf(value: string): string | null {
	try {
		const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return null;
	}
}

/** An address whose pieces are all present but interrupted: `ada @ example . com`. */
const SPACED_EMAIL = /(?<![\w.+-])[\w.+-]+\s*@\s*[\w-]+(?:\s*\.\s*[\w-]+)+/g;

/**
 * An email that survived layout but not extraction shows up as `name @ example.com` — every
 * character is there, but a space landed inside the address.
 *
 * Matched against a line's own text rather than a re-joined run of spans: on a two-column page one
 * line can hold a sidebar address beside an unrelated main-column sentence, and gluing those
 * together would invent an address that is not in the file.
 */
function detectSplitEmail(document: ExtractedDocument): boolean {
	return document.lines.some((line) => (line.text.match(SPACED_EMAIL) ?? []).some((candidate) => /\s/.test(candidate)));
}

/**
 * Compares each link annotation's destination against the text drawn underneath it.
 *
 * Annotation rectangles are in PDF user space (origin bottom-left) while spans have already been
 * flipped to top-left, so the rectangle is flipped here rather than un-flipping every span.
 */
function findLinkMismatches(raw: RawExtraction, document: ExtractedDocument): { shown: string; target: string }[] {
	const mismatches: { shown: string; target: string }[] = [];

	for (const link of raw.links) {
		const target = link.url ? hostOf(link.url) : null;
		if (!target) continue;

		const page = document.pages.find((candidate) => candidate.pageNumber === link.page);
		const rawPage = raw.pages.find((candidate) => candidate.pageNumber === link.page);
		if (!page || !rawPage) continue;

		const [x1, y1, x2, y2] = link.rect;
		const left = Math.min(x1, x2);
		const right = Math.max(x1, x2);
		const top = rawPage.height - Math.max(y1, y2);
		const bottom = rawPage.height - Math.min(y1, y2);

		// Spans, not lines: baseline clustering merges a whole contact row into one line, and the
		// domain half of an email address in that row would otherwise read as the link's own text.
		const covered = page.lines
			.flatMap((line) => line.spans)
			.filter((span) => span.x < right && span.x + span.width > left && span.y < bottom && span.y + span.height > top)
			.map((span) => span.text)
			.join("")
			.trim();

		if (covered.length === 0 || EMAIL_TEST.test(covered)) continue;

		const shownUrl = covered.match(URL_PATTERN)?.[0] ?? covered.match(BARE_DOMAIN_PATTERN)?.[0];
		if (!shownUrl) continue;

		const shown = hostOf(shownUrl);
		if (shown && shown !== target) mismatches.push({ shown, target });
	}

	return mismatches;
}

function looksLikeName(line: TextLine): boolean {
	const text = line.text.trim();
	if (text.length === 0 || text.length > 60) return false;
	if (EMAIL_TEST.test(text)) return false;
	if (/\d/.test(text)) return false;

	const words = text.split(/\s+/);
	if (words.length < 2 || words.length > MAX_NAME_WORDS) return false;

	// Names are letters, hyphens and apostrophes, and nothing else.
	return words.every((word) => /^[\p{L}][\p{L}'.-]*$/u.test(word));
}

export function analyzeContact(raw: RawExtraction, document: ExtractedDocument): ContactEntities {
	const text = document.fullText;

	const emails = uniqueStrings(text.match(EMAIL_PATTERN) ?? []);
	const phones = extractPhones(text);

	const fullUrls = uniqueStrings(text.match(URL_PATTERN) ?? []);
	// A bare-domain hit is the same link twice when it sits inside a full URL, and not a link at
	// all when it is the domain half of an email address.
	const bareUrls = uniqueStrings(text.match(BARE_DOMAIN_PATTERN) ?? []).filter(
		(url) => !fullUrls.some((full) => full.includes(url)) && !emails.some((email) => email.endsWith(`@${url}`)),
	);

	const textUrls = [...fullUrls, ...bareUrls].filter((url) => !emails.some((email) => url.includes(email)));

	const annotationUrls = uniqueStrings(raw.links.map((link) => link.url).filter((url): url is string => !!url));

	const firstPageLines = document.pages[0]?.lines ?? [];
	const nameLine = firstPageLines.slice(0, FIRST_PAGE_CONTACT_LINES).find(looksLikeName)?.text.trim() ?? null;

	const locationLine =
		firstPageLines
			.slice(0, FIRST_PAGE_CONTACT_LINES)
			.flatMap((line) => line.text.split(/[·|•]/).map((part) => part.trim()))
			.find(
				(candidate) =>
					/^[\p{L}\p{M} .'-]+,\s*[\p{L}\p{M} .'-]+$/u.test(candidate) &&
					!candidate.endsWith(".") &&
					candidate.trim().split(/\s+/).length <= 6,
			)
			?.trim() ?? null;

	return {
		emails,
		phones,
		textUrls,
		annotationUrls,
		nameLine,
		locationLine,
		emailLooksSplit: detectSplitEmail(document),
		linkMismatches: findLinkMismatches(raw, document),
	};
}

/**
 * A link that shows work: a known profile (LinkedIn, GitHub…) or any web address of its own, such as a portfolio. Only
 * the email address's own domain doesn't count, and neither do mail or phone links.
 */
export function hasProfessionalLink(contact: ContactEntities): boolean {
	const all = [...contact.textUrls, ...contact.annotationUrls];
	const emailDomains = new Set(contact.emails.map((email) => email.split("@")[1]?.toLowerCase() ?? ""));
	return all.some((url) => {
		if (/^[a-z][a-z\d+.-]*:/i.test(url) && !/^https?:/i.test(url)) return false;
		const host = hostOf(url);
		if (!host?.includes(".")) return false;
		return PROFESSIONAL_HOSTS.some((known) => host === known || host.endsWith(`.${known}`)) || !emailDomains.has(host);
	});
}

/** True when contact details appear only after the first page. */
export function contactIsOnFirstPage(document: ExtractedDocument, contact: ContactEntities): boolean {
	if (contact.emails.length === 0 && contact.phones.length === 0) return false;

	const firstPageText = (document.pages[0]?.lines ?? []).map((line) => line.text).join("\n");

	return (
		contact.emails.some((email) => firstPageText.includes(email)) ||
		contact.phones.some((phone) => firstPageText.includes(phone))
	);
}
