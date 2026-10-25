import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { CSSProperties } from "react";

export type PreviewPageSize = {
	height: number;
	width: number;
};

// Pages are drawn at the screen's pixel density, and never below 2x so text stays crisp on 1x screens. A fixed 4x
// drew 4–16 times the pixels the screen shows, on every update of every page.
const MIN_PREVIEW_RENDER_SCALE = 2;
const MAX_PREVIEW_CANVAS_PIXELS = 16_777_216; // 4096 * 4096

export const DEFAULT_PDF_PAGE_SIZE: PreviewPageSize = {
	height: 841.89,
	width: 595.28,
};

export const getPreviewCanvasScale = (width: number, height: number) => {
	const devicePixelRatio = window.devicePixelRatio || 1;
	const desiredScale = Math.max(MIN_PREVIEW_RENDER_SCALE, devicePixelRatio);
	const desiredPixels = width * height * desiredScale * desiredScale;

	if (desiredPixels <= MAX_PREVIEW_CANVAS_PIXELS) return desiredScale;

	return Math.sqrt(MAX_PREVIEW_CANVAS_PIXELS / (width * height));
};

export const getScaledPreviewPageSize = (pageSize: PreviewPageSize, pageScale: number): PreviewPageSize => ({
	height: pageSize.height * pageScale,
	width: pageSize.width * pageScale,
});

export const getResumePreviewGapValue = (pageGap: CSSProperties["gap"]) =>
	typeof pageGap === "number" && pageGap !== 0 ? `${pageGap}px` : pageGap;

export const getResumePreviewPageCount = (data?: ResumeData) => Math.max(1, data?.metadata.layout.pages.length ?? 1);
