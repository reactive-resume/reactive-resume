// A wheel notch (deltaY 100) changes the scale by about 22%; a trackpad pinch sends smaller deltas, so it stays smooth
// instead of jumping a whole step per event.
const WHEEL_ZOOM_INTENSITY = 0.002;
const WHEEL_LINE_HEIGHT = 16;

/** Wheel deltas in pixels: Firefox reports lines, some browsers report pages. */
function wheelDeltaPixels(deltaY: number, deltaMode: number, viewportHeight: number) {
	if (deltaMode === 1) return deltaY * WHEEL_LINE_HEIGHT;
	if (deltaMode === 2) return deltaY * Math.max(1, viewportHeight);
	return deltaY;
}

/** The explicit scale a wheel scroll asks for: up (negative deltaY) zooms in, down zooms out. */
export function wheelZoom(current: number, deltaY: number, deltaMode = 0, viewportHeight = 0) {
	return current * Math.exp(-wheelDeltaPixels(deltaY, deltaMode, viewportHeight) * WHEEL_ZOOM_INTENSITY);
}

/** A page point held under the pointer while its scale changes, before the new layout is measured. */
export type ZoomAnchor = {
	page: Element;
	contentX: number;
	contentY: number;
	ratio: number;
	pointerX: number;
	pointerY: number;
};

/** Scroll offsets that keep the anchored page point under the pointer after the scale change is laid out. */
export function anchoredScroll(
	anchor: ZoomAnchor,
	scroll: { left: number; top: number },
	pageBounds: { left: number; top: number },
) {
	return {
		// No lower bound: RTL canvases scroll to negative `scrollLeft` values, and the browser clamps out-of-range
		// writes on its own.
		left: scroll.left + pageBounds.left + anchor.contentX * anchor.ratio - anchor.pointerX,
		top: Math.max(0, scroll.top + pageBounds.top + anchor.contentY * anchor.ratio - anchor.pointerY),
	};
}
