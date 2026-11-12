import type { ResumeRenderOptions } from "./context";
import type { FormeEngine } from "./forme/render";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as forme from "@formepdf/core";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { createFontPreparer, createFontSubsetter } from "./forme/font-subset";
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

// Fonts cut to each document's characters, as in the browser (#3593): Forme takes every font as base64 in the JSON
// of each layout pass, so whole CJK faces cost seconds and hundreds of megabytes per export. If harfbuzz can't
// load, fonts go whole as before.
let engine: Promise<FormeEngine> | undefined;
async function createEngine(): Promise<FormeEngine> {
	// Workers can't compile WebAssembly from bytes, so there fonts still go whole.
	if (process.env.CLOUDFLARE === "1") return forme;
	try {
		// A built server carries the file beside its bundle (a Vercel Function has no node_modules entry for a file
		// that is only read). From source, and in tests, it comes from the package.
		const wasm = await readFile(new URL("./wasm/harfbuzz-subset.wasm", import.meta.url)).catch(() =>
			readFile(fileURLToPath(import.meta.resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"))),
		);
		return {
			renderSerializedDocWithLayout: forme.renderSerializedDocWithLayout,
			prepareFont: createFontPreparer(await createFontSubsetter(wasm)),
		};
	} catch (error) {
		console.warn("[pdf] Font subsetting is unavailable; PDFs render from whole fonts.", {
			name: error instanceof Error ? error.name : "Unknown",
		});
		return forme;
	}
}

/** Creates a server PDF using deployment font mirroring and the server image reader. */
export const createResumePdfFile = async ({
	filename,
	uploadOrigin,
	...input
}: CreateResumePdfFileOptions): Promise<File> => {
	const result = await renderResume(await (engine ??= createEngine()), {
		...input,
		data: parseResumeData(input.data),
		readImage: (source) => readServerImage(source, uploadOrigin),
		webFontBaseUrl: process.env.WEB_FONT_BASE_URL,
		fontMirrorUrl: process.env.FONT_MIRROR_URL,
	});
	// Characters no font can draw print as "?" rather than failing the file; the editor names them.
	assertPdfFonts(result, process.env.FONT_MIRROR_URL);
	return new File([result.pdf as Uint8Array<ArrayBuffer>], filename, { type: "application/pdf" });
};

/**
 * What a resume's link preview card draws with: the font files its typography and scripts need, and its picture as a
 * data URI (only a picture the server may read; a failed one is left out).
 */
export async function loadResumeCardAssets(data: ResumeData, uploadOrigin: string) {
	const { fonts, missing } = await loadFonts(
		resumeFontRequests(data),
		process.env.WEB_FONT_BASE_URL,
		process.env.FONT_MIRROR_URL,
	);
	// Resvg would draw a missing face in another family; the caller shows its banner and retries next time.
	if (missing.length > 0) throw new Error(`Fonts could not be loaded: ${missing.join(", ")}`);
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
