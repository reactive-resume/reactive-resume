import type { ResumeRenderOptions } from "./context";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import * as forme from "@formepdf/core";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { loadFonts } from "./forme/fonts";
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
export async function loadResumeCardAssets(data: ResumeData, uploadOrigin?: string) {
	const parsed = parseResumeData(data);
	const { fonts } = await loadFonts(resumeFontRequests(parsed), process.env.WEB_FONT_BASE_URL);
	let picture: string | undefined;
	if (parsed.picture.url && !parsed.picture.hidden) {
		// A relative picture is one of the app's own files; a bad address leaves the card without a picture.
		const source = uploadOrigin ? new URL(parsed.picture.url, uploadOrigin).href : parsed.picture.url;
		const bytes = await Promise.resolve()
			.then(() => readServerImage(source, uploadOrigin))
			.catch(() => null);
		const type = bytes && imageType(bytes);
		if (bytes && type) picture = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
	}
	const family = (value: string | string[]) => (Array.isArray(value) ? (value[0] ?? "") : value);
	return {
		fonts: fonts.map((font) => font.src as Uint8Array),
		headingFamily: family(parsed.metadata.typography.heading.fontFamily),
		bodyFamily: family(parsed.metadata.typography.body.fontFamily),
		picture,
	};
}

const imageType = (bytes: Uint8Array) => {
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
	if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
	if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
	return undefined;
};
