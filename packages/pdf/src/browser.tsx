import type { ResumeRenderOptions } from "./context";
import type { PageMap } from "./page-map";
import type { SectionTitleResolver } from "./section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import wasmUrl from "@formepdf/core/pkg-web/forme_bg.wasm?url";
import * as forme from "@formepdf/core/worker";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { assertPdfText, renderResume } from "./forme/render";

export type CreateResumePdfBlobOptions = {
	data: ResumeData;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	/** Receives the header, section and item boxes of this render (see `page-map.ts`). */
	onPageMap?: ((pageMap: PageMap) => void) | undefined;
};

export const createResumePdfBlob = async ({ onPageMap, ...input }: CreateResumePdfBlobOptions): Promise<Blob> => {
	const data = parseResumeData(input.data);
	// The engine downloads with the first PDF, not with the app.
	await forme.init(wasmUrl);
	const result = await renderResume(forme, { ...input, data });
	assertPdfText(result);
	const { pdf, pageMap } = result;
	onPageMap?.(pageMap);
	return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
};
