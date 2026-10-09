import type { ResumeRenderOptions } from "./context";
import type { PageMap } from "./page-map";
import type { SectionTitleResolver } from "./section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import wasmUrl from "@formepdf/core/pkg-web/forme_bg.wasm?url";
import * as forme from "@formepdf/core/worker";
import subsetWasmUrl from "harfbuzzjs/dist/harfbuzz-subset.wasm?url";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { createFontPreparer, createFontSubsetter } from "./forme/font-subset";
import { assertPdfText, renderResume } from "./forme/render";

export type CreateResumePdfBlobOptions = {
	data: ResumeData;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	/** Receives the header, section and item boxes of this render (see `page-map.ts`). */
	onPageMap?: ((pageMap: PageMap) => void) | undefined;
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

export const createResumePdfBlob = async ({ onPageMap, ...input }: CreateResumePdfBlobOptions): Promise<Blob> => {
	const data = parseResumeData(input.data);
	// The engine downloads with the first PDF, not with the app.
	const [prepareFont] = await Promise.all([loadFontPreparer(), forme.init(wasmUrl)]);
	const result = await renderResume(
		{ renderSerializedDocWithLayout: forme.renderSerializedDocWithLayout, prepareFont },
		{ ...input, data },
	);
	assertPdfText(result);
	const { pdf, pageMap } = result;
	onPageMap?.(pageMap);
	return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
};
