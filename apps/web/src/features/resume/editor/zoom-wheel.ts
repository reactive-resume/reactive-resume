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

/** Where to scroll a canvas so the content point under the pointer stays there after a scale change. */
export function scrollAfterZoom(scroll: number, pointer: number, before: number, after: number) {
	const next = (scroll + pointer) * (after / before) - pointer;
	return Number.isFinite(next) ? Math.max(0, next) : scroll;
}
