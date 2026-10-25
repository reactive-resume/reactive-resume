// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vite-plus/test";
import { getPreviewCanvasScale } from "./preview.shared.utils";

const setDevicePixelRatio = (value: number) => {
	Object.defineProperty(window, "devicePixelRatio", {
		writable: true,
		configurable: true,
		value,
	});
};

afterEach(() => {
	setDevicePixelRatio(1);
});

describe("getPreviewCanvasScale", () => {
	it("clamps the scale when the page would exceed the canvas pixel budget", () => {
		setDevicePixelRatio(1);
		const scale = getPreviewCanvasScale(2000, 3000);
		// Below the 2x minimum here, because the page would exceed the pixel budget.
		expect(scale).toBeLessThan(2);
		expect(scale * scale * 2000 * 3000).toBeLessThanOrEqual(16_777_216 + 1);
	});
});
