import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { PixelRatio } from "react-native";
import { createSerialQueue } from "@reactive-resume/utils/queue";
import { createPreviewPipeline } from "./pipeline";

export const A4_WIDTH_PT = 595.28;
// Thumbnails are drawn a little wider than shown, in steps, so small layout changes reuse the stored image.
const WIDTH_STEP = 32;

/** Pixel width to draw a thumbnail shown `width` points wide, capped at six times the A4 width. */
export const thumbnailPixelWidth = (width: number) =>
	Math.min(6 * A4_WIDTH_PT, Math.ceil((width * PixelRatio.get()) / WIDTH_STEP) * WIDTH_STEP);

const queue = createSerialQueue();

/**
 * Runs document thumbnails one at a time, so a library of cards never renders in parallel or competes with the
 * editor. A task whose card went away while it waited is skipped.
 */
export function enqueueThumbnail<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
	return queue(() => {
		signal.throwIfAborted();
		return task();
	});
}

/**
 * Draws the first page `pixelWidth` pixels wide, in `template` when given; `keep` must copy the PNG, which is
 * deleted afterwards.
 */
export async function renderFirstPage<T>(
	data: ResumeData,
	pixelWidth: number,
	keep: (uri: string) => Promise<T>,
	template?: Template,
) {
	const pipeline = createPreviewPipeline();
	try {
		const result = await pipeline.render({ id: 0, data, template, pages: [0], scale: pixelWidth / A4_WIDTH_PT });
		const page = result.pages[0];
		if (!page) throw new Error("The resume has no pages");
		return await keep(page.uri);
	} finally {
		await pipeline.dispose().catch(() => undefined);
	}
}
