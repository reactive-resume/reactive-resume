import { escapeHtml } from "@reactive-resume/utils/string";

export type ResumeCardInput = {
	name: string;
	headline: string;
	/** Where the page lives, as people read it: `rx.cv/john`, `john.dev`. */
	address: string;
	/** The resume's primary colour (any CSS colour the SVG renderer reads). */
	color: string;
	headingFamily: string;
	bodyFamily: string;
	/** The picture as a data URI, when the resume shows one. */
	picture?: string | undefined;
};

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/**
 * Splits text into at most `lines` lines of about `width` characters, ending in an ellipsis when it doesn't fit.
 * ponytail: counts characters, not measured widths; fine for names and headlines at these sizes.
 */
function wrap(text: string, width: number, lines: number): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const result: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (next.length <= width || !line) line = next;
		else {
			result.push(line);
			line = word;
		}
		if (result.length === lines) break;
	}
	if (result.length < lines && line) result.push(line);
	const fitted = result.slice(0, lines).map((part) => (part.length > width ? `${part.slice(0, width - 1)}…` : part));
	const used = fitted.join(" ").replace(/…$/, "").length;
	if (used < text.trim().length && fitted.length > 0 && !fitted.at(-1)?.endsWith("…"))
		fitted[fitted.length - 1] = `${(fitted.at(-1) ?? "").replace(/\s*\S{0,3}$/, "")}…`;
	return fitted;
}

/** The link preview of a resume's web page: name, headline, picture and address, in the resume's fonts and colour. */
export function resumeCardSvg(card: ResumeCardInput): string {
	const nameLines = wrap(card.name, card.picture ? 18 : 26, 2);
	const headlineLines = wrap(card.headline, card.picture ? 34 : 50, 2);
	const nameSize = 76;
	const headlineSize = 34;
	const nameTop = 200;
	const headlineTop = nameTop + nameLines.length * nameSize * 1.1 + 24;
	const text = (lines: string[], top: number, size: number, font: string, weight: number, fill: string) =>
		lines
			.map(
				(line, index) =>
					`<text x="96" y="${Math.round(top + index * size * 1.15)}" font-family="${escapeHtml(font)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(line)}</text>`,
			)
			.join("");

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
		`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#ffffff"/>`,
		`<rect width="24" height="${CARD_HEIGHT}" fill="${escapeHtml(card.color)}"/>`,
		card.picture
			? `<defs><clipPath id="p"><circle cx="980" cy="270" r="150"/></clipPath></defs><image x="830" y="120" width="300" height="300" preserveAspectRatio="xMidYMid slice" clip-path="url(#p)" xlink:href="${escapeHtml(card.picture)}"/>`
			: "",
		text(nameLines, nameTop, nameSize, card.headingFamily, 700, "#111111"),
		text(headlineLines, headlineTop, headlineSize, card.bodyFamily, 400, "#4b4b52"),
		`<text x="96" y="${CARD_HEIGHT - 72}" font-family="${escapeHtml(card.bodyFamily)}" font-size="28" font-weight="600" fill="${escapeHtml(card.color)}">${escapeHtml(card.address)}</text>`,
		"</svg>",
	].join("");
}
