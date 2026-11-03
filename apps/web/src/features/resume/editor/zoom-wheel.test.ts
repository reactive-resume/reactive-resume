import { describe, expect, it } from "vite-plus/test";
import { clampZoom } from "./store";
import { scrollAfterZoom, wheelZoom } from "./zoom-wheel";

describe("wheelZoom", () => {
	it("zooms in when the wheel turns up and out when it turns down", () => {
		expect(wheelZoom(1, -100)).toBeCloseTo(1.22, 2);
		expect(wheelZoom(1, 100)).toBeCloseTo(0.82, 2);
	});

	it("reads line and page deltas as pixels, so every browser asks for the same change", () => {
		expect(wheelZoom(1, -3, 1)).toBeCloseTo(wheelZoom(1, -48), 5);
		expect(wheelZoom(1, -1, 2, 900)).toBeCloseTo(wheelZoom(1, -900), 5);
	});

	it("stays inside the editor's zoom bounds once clamped", () => {
		expect(clampZoom(wheelZoom(2.9, -1000))).toBe(3);
		expect(clampZoom(wheelZoom(0.7, 1000))).toBe(0.6);
	});
});

describe("scrollAfterZoom", () => {
	it("keeps the content point under the pointer", () => {
		expect(scrollAfterZoom(0, 300, 1, 2)).toBe(300);
		expect(scrollAfterZoom(200, 100, 1, 2)).toBe(500);
	});

	it("never scrolls past the start of the canvas", () => {
		expect(scrollAfterZoom(0, 0, 2, 1)).toBe(0);
	});
});
