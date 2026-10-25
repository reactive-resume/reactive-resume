import type { ResumeRenderOptions } from "./context";
import type { PageMap } from "./page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import wasmUrl from "@formepdf/core/pkg-web/forme_bg.wasm?url";
import * as forme from "@formepdf/core/worker";
import subsetWasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { createFontPreparer, createFontSubsetter } from "./forme/font-subset";
import { loadFonts } from "./forme/fonts";
import { assertPdfFonts, lostCharacters, renderResume, resumeFontRequests } from "./forme/render";

export type CreateResumePdfBlobOptions = {
	data: ResumeData;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	/** Receives the header, section and item boxes of this render (see `page-map.ts`). */
	onPageMap?: ((pageMap: PageMap) => void) | undefined;
	/**
	 * Receives the characters no font in the resume could draw (`"₹" (U+20B9)`), which print as "?"; empty when
	 * Forme didn't name them. Not called when every character rendered.
	 */
	onLostCharacters?: ((characters: string[]) => void) | undefined;
};

// Fonts cut to each document's characters and encoded once: whole CJK faces, which Forme encodes byte by byte on
// every render, made each render of a CJK resume take seconds (#3593). If harfbuzz can't load, fonts go whole.
let fontPreparer: Promise<ReturnType<typeof createFontPreparer>> | undefined;
const loadFontPreparer = () =>
	(fontPreparer ??= fetch(subsetWasmUrl)
		.then((response) => response.arrayBuffer())
		.then(createFontSubsetter)
		.catch(() => null)
		.then(createFontPreparer));

// The engine downloads with the first PDF, not with the app, and while that PDF's fonts download.
let engine: Promise<unknown> | undefined;
const loadEngine = () =>
	(engine ??= forme.init(wasmUrl).catch((error: unknown) => {
		// A failed download may succeed next time.
		engine = undefined;
		throw error;
	}));

/**
 * Starts downloading the engine and a resume's fonts, so they arrive while the caller prepares the rest of its
 * render (section titles in its language); the render then finds them cached.
 */
export const preloadResumePdf = (data: ResumeData) => {
	loadEngine().catch(() => undefined);
	void loadFontPreparer();
	void loadFonts(resumeFontRequests(parseResumeData(data)));
};

export const createResumePdfBlob = async ({
	onPageMap,
	onLostCharacters,
	...input
}: CreateResumePdfBlobOptions): Promise<Blob> => {
	const data = parseResumeData(input.data);
	const ready = Promise.all([loadEngine(), loadFontPreparer()]);
	// A failed engine download surfaces from the render; this only keeps it from being reported unhandled.
	ready.catch(() => undefined);
	const result = await renderResume(
		{
			renderSerializedDocWithLayout: async (document) => {
				await ready;
				return forme.renderSerializedDocWithLayout(document);
			},
			prepareFont: async (bytes, text) => (await ready)[1](bytes, text),
		},
		{ ...input, data },
	);
	assertPdfFonts(result);
	const { pdf, pageMap, warnings } = result;
	onPageMap?.(pageMap);
	const lost = lostCharacters(warnings);
	if (lost) onLostCharacters?.(lost);
	return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
};
