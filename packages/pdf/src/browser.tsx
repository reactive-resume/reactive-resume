import type { ResumeRenderOptions } from "./context";
import type { PageMap } from "./page-map";
import type { SectionTitleResolver } from "./section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import wasmUrl from "@formepdf/core/pkg-web/forme_bg.wasm?url";
import * as forme from "@formepdf/core/worker";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { renderResume } from "./forme/render";

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
	// The 6.5 MB engine downloads with the first PDF, not with the app.
	await forme.init(wasmUrl);
	const { pdf, pageMap, missingFonts } = await renderResume(forme, { ...input, data });
	// Without its fonts the document would look wrong; callers fall back to the server's PDF instead.
	if (missingFonts.length > 0) throw new Error(`Fonts could not be loaded: ${missingFonts.join(", ")}`);
	onPageMap?.(pageMap);
	return new Blob([pdf as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
};
