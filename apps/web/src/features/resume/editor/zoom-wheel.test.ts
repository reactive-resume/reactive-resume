import { describe, expect, it } from "vite-plus/test";
import { anchoredScroll, wheelZoom } from "./zoom-wheel";

describe("wheelZoom", () => {
	it("reads line and page deltas as pixels, so every browser asks for the same change", () => {
		expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48), 5);
		expect(wheelZoom(1, -1, 2, 900)).toBeCloseTo(wheelZoom(1, -900), 5);
	});
});

describe("anchoredScroll", () => {
	const anchor = (contentX: number, contentY: number, ratio: number, pointerX: number, pointerY: number) => ({
		page: {} as Element,
		contentX,
		contentY,
		ratio,
		pointerX,
		pointerY,
	});

	it("adds the change to the scroll already there", () => {
		expect(anchoredScroll(anchor(220, 200, 2, 400, 300), { left: 100, top: 50 }, { left: 80, top: 50 })).toEqual({
			left: 220,
			top: 200,
		});
	});

	it("keeps negative horizontal offsets for RTL canvases but never scrolls above the top", () => {
		expect(anchoredScroll(anchor(100, 100, 1, 400, 300), { left: 0, top: 0 }, { left: 180, top: 100 })).toEqual({
			left: -120,
			top: 0,
		});
	});
});
