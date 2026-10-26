import type { PdfFontRequest } from "../hooks/use-register-fonts";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createElement } from "react";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { ResumeDocument } from "../document";
import { loadRequestedIcons } from "../forme/icons";
import { renderHostTree } from "../forme/reconciler";
import { resumeFontRequests } from "../forme/render";
import { toHtml } from "./to-html";

export type ResumeWebPage = {
	/** The resume's language, for the document's `lang` (and from it, `dir`). */
	lang: string;
	/** The sheet, to place inside an element with class `rr`. */
	html: string;
	/** Font faces and the sheet's rules. */
	css: string;
};

export type RenderResumeWebPageInput = {
	/** Already redacted for the viewer: the web page draws everything it's given, in the resume's own template. */
	data: ResumeData;
	imageUrl?: ((source: string) => string | undefined) | undefined;
};

/**
 * A web page draws the template once: the header, then every page's main sections, then every page's sidebar sections.
 * A page laid out full width draws no sidebar in the PDF, so its sidebar sections stay out here too. Print settings
 * that only mean something on paper (free-form height) fall back to the page's width.
 */
export function toWebLayout(data: ResumeData): ResumeData {
	const { pages } = data.metadata.layout;
	const main = pages.flatMap((page) => page.main);
	const sidebar = pages.flatMap((page) => (page.fullWidth ? [] : page.sidebar));
	const fullWidth = pages.length > 0 && pages.every((page) => page.fullWidth);
	return {
		...data,
		metadata: {
			...data.metadata,
			page: { ...data.metadata.page, format: data.metadata.page.format === "letter" ? "letter" : "a4" },
			layout: { ...data.metadata.layout, pages: [{ fullWidth, main, sidebar }] },
		},
	};
}

const fontFaces = (requests: readonly PdfFontRequest[]) =>
	requests
		.filter((request) => request.src.startsWith("https://"))
		.map(
			(request) =>
				`@font-face{font-family:"${request.family.replace(/["\\<>{};]/g, "")}";font-weight:${Number(request.weight) || 400};font-style:${request.italic ? "italic" : "normal"};font-display:swap;src:url("${encodeURI(request.src).replaceAll('"', "%22")}")}`,
		)
		.join("\n");

/** A picture on the page: uploads load from `origin` (the app), wherever the page is served; other pictures as given. */
export const webPageImageUrl =
	(origin: string) =>
	(source: string): string | undefined => {
		if (source.startsWith("/")) return `${origin}${source}`;
		return /^(https?:|data:image\/)/i.test(source) ? source : undefined;
	};

/** Renders a resume as the markup of its web page. Runs on the server and in the browser (the Share preview). */
export async function renderResumeWebPage(input: RenderResumeWebPageInput): Promise<ResumeWebPage> {
	const data = toWebLayout(parseResumeData(input.data));
	const element = createElement(ResumeDocument, { data, template: data.metadata.template });
	let tree = renderHostTree(element);
	// Icons load on first use: a tree that asked for new ones is drawn again once they arrive.
	if (await loadRequestedIcons()) tree = renderHostTree(element);
	const { html, css } = toHtml(tree, { imageUrl: input.imageUrl });
	return {
		lang: data.metadata.page.locale,
		html,
		css: `${fontFaces(resumeFontRequests(data))}\n${css}`,
	};
}
