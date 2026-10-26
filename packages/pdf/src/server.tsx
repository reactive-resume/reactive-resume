import type { ResumeRenderOptions } from "./context";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import * as forme from "@formepdf/core";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { loadFonts } from "./forme/fonts";
import { loadImages } from "./forme/images";
import { readServerImage } from "./forme/images.node.ts";
import { assertPdfFonts, renderResume, resumeFontRequests } from "./forme/render";

// The `.ts` matters: Node reads a bare `.node` ending as a native addon, so dev (tsx) can't resolve it without one.
export { configureOwnPictureReader } from "./forme/images.node.ts";

export type CreateResumePdfFileOptions = {
	data: ResumeData;
	filename: string;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	/** Operator-configured app origin; only its public picture upload paths may use private addresses. */
	uploadOrigin?: string | undefined;
};

/** Creates a server PDF using deployment font mirroring and the server image reader. */
export const createResumePdfFile = async ({
	filename,
	uploadOrigin,
	...input
}: CreateResumePdfFileOptions): Promise<File> => {
	const result = await renderResume(forme, {
		...input,
		data: parseResumeData(input.data),
		readImage: (source) => readServerImage(source, uploadOrigin),
		webFontBaseUrl: process.env.WEB_FONT_BASE_URL,
	});
	// Characters no font can draw print as "?" rather than failing the file; the editor names them.
	assertPdfFonts(result);
	return new File([result.pdf as Uint8Array<ArrayBuffer>], filename, { type: "application/pdf" });
};

/**
 * What a resume's link preview card draws with: the font files its typography and scripts need, and its picture as a
 * data URI (only a picture the server may read; a failed one is left out).
 */
export async function loadResumeCardAssets(data: ResumeData, uploadOrigin: string) {
	const { fonts } = await loadFonts(resumeFontRequests(data), process.env.WEB_FONT_BASE_URL);
	const source = data.picture.url && !data.picture.hidden ? data.picture.url : undefined;
	// A relative picture is one of the app's own files.
	const { images } = await loadImages(source ? [source] : [], (url) =>
		readServerImage(new URL(url, uploadOrigin).href, uploadOrigin),
	);
	return {
		fonts: fonts.map((font) => font.src as Uint8Array),
		headingFamily: data.metadata.typography.heading.fontFamily,
		bodyFamily: data.metadata.typography.body.fontFamily,
		picture: source ? images.get(source)?.src : undefined,
	};
}
