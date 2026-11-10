// The preview pipeline's contract (M3-T4 implements it): draft data in, rasterised pages and the page map out.
// Renders run on the device through @reactive-resume/pdf/native and @reactive-resume/forme-native.
import type { PageMap, ResumeRenderOptions } from "@reactive-resume/pdf/native";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";

export type { ResumeRenderOptions } from "@reactive-resume/pdf/native";

export type RenderRequest = {
	/** Increases with every request. The scheduler drops a result when a newer request has been made. */
	id: number;
	data: ResumeData;
	/** Renders with another template than `data.metadata.template` (Design → Template thumbnails). */
	template?: Template | undefined;
	/** Passed through to the renderer unchanged. */
	renderOptions?: ResumeRenderOptions | undefined;
	/** A field has focus: the debounce is 250 ms instead of 100 ms (the web values). */
	focused?: boolean | undefined;
	/** Rasterise only these zero-based pages; all pages when omitted. */
	pages?: number[] | undefined;
	/** Pixels per PDF point for the PNGs, for example the screen scale times the zoom. */
	scale: number;
};

export type RenderedPage = {
	/** Zero-based page number. */
	index: number;
	/** A `file://` PNG in the cache directory. */
	uri: string;
	/** Page size in PDF points. */
	width: number;
	height: number;
};

export type RenderedPages = {
	/** The `RenderRequest.id` this answers. */
	requestId: number;
	pageCount: number;
	pages: RenderedPage[];
	/** Header, section and item boxes per page, for the tap-to-edit overlay. */
	pageMap: PageMap;
	/** Characters no font could draw (`"₹" (U+20B9)`); empty when everything rendered. */
	lostCharacters: string[];
	/** Includes text loss for which the engine could not name a character. */
	hasTextLoss?: boolean | undefined;
	/** The PDF itself, for download, share and print. */
	pdf: Uint8Array;
};
