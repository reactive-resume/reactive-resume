// @vitest-environment happy-dom

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { usePageScale } from "./chrome";
import { useEditorStore } from "./store";

function Canvas({ pages = 0 }: { pages?: number }) {
	const { canvasRef } = usePageScale("a4");
	return (
		<section ref={canvasRef} data-testid="canvas">
			{Array.from({ length: pages }, (_, index) => (
				<div key={index} data-testid={`page-${index + 1}`}>
					<canvas />
				</div>
			))}
		</section>
	);
}

const bounds = (left: number, top: number): DOMRect => ({
	left,
	top,
	width: 0,
	height: 0,
	right: left,
	bottom: top,
	x: left,
	y: top,
	toJSON: () => ({}),
});

function wheel(canvas: HTMLElement, init: WheelEventInit) {
	const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
	// happy-dom's WheelEvent extends UIEvent and drops the modifier keys a browser reports on it.
	Object.assign(event, init);
	act(() => {
		canvas.dispatchEvent(event);
	});
	return event;
}

describe("canvas zoom", () => {
	beforeEach(() => {
		useEditorStore.setState({ zoom: "fit" });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("zooms the canvas on Ctrl+wheel, and stops the browser from zooming instead", () => {
		const { getByTestId } = render(<Canvas />);
		const event = wheel(getByTestId("canvas"), { deltaY: -100, ctrlKey: true });

		expect(event.defaultPrevented).toBe(true);
		expect(useEditorStore.getState().zoom).toBeGreaterThan(1);
	});

	it("zooms on Cmd+wheel too", () => {
		const { getByTestId } = render(<Canvas />);
		wheel(getByTestId("canvas"), { deltaY: -100, metaKey: true });

		expect(useEditorStore.getState().zoom).toBeGreaterThan(1);
	});

	it("zooms out from Fit to an explicit scale", () => {
		const { getByTestId } = render(<Canvas />);
		wheel(getByTestId("canvas"), { deltaY: 100, ctrlKey: true });

		expect(useEditorStore.getState().zoom).toBeLessThan(1);
	});

	it("leaves a plain wheel to scroll the canvas", () => {
		const { getByTestId } = render(<Canvas />);
		const event = wheel(getByTestId("canvas"), { deltaY: -100 });

		expect(event.defaultPrevented).toBe(false);
		expect(useEditorStore.getState().zoom).toBe("fit");
	});

	it("leaves Ctrl+wheel outside the canvas to the browser", () => {
		render(<Canvas />);
		const event = wheel(document.body, { deltaY: -100, ctrlKey: true });

		expect(event.defaultPrevented).toBe(false);
		expect(useEditorStore.getState().zoom).toBe("fit");
	});

	it("adds up small wheel deltas instead of rounding each one away", () => {
		const { getByTestId } = render(<Canvas />);
		const canvas = getByTestId("canvas");

		wheel(canvas, { deltaY: -1, ctrlKey: true });
		wheel(canvas, { deltaY: -1, ctrlKey: true });
		wheel(canvas, { deltaY: -1, ctrlKey: true });

		expect(useEditorStore.getState().zoom).toBe(1.01);
	});

	it("keeps the page point under the pointer and scrolls the canvas with it", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));

		const { getByTestId } = render(<Canvas pages={1} />);
		const canvas = getByTestId("canvas");
		const page = getByTestId("page-1");
		canvas.getBoundingClientRect = () => bounds(0, 0);
		page.getBoundingClientRect = () => bounds(180, 100);

		wheel(canvas, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
		// Layout moves the page after the zoom; the scroll must follow its new position.
		page.getBoundingClientRect = () => bounds(200, 130);
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		expect(canvas.scrollLeft).toBeCloseTo(68.4, 5);
		expect(canvas.scrollTop).toBeCloseTo(74, 5);
	});

	it("keeps every pending scale change when the pointer moves to another page", () => {
		const frames: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));

		const { getByTestId } = render(<Canvas pages={2} />);
		const canvas = getByTestId("canvas");
		const first = getByTestId("page-1");
		const second = getByTestId("page-2");
		canvas.getBoundingClientRect = () => bounds(0, 0);
		first.getBoundingClientRect = () => bounds(180, 100);
		second.getBoundingClientRect = () => bounds(180, 900);

		wheel(canvas, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 300 });
		wheel(canvas, { deltaY: -100, ctrlKey: true, clientX: 400, clientY: 1000 });
		act(() => {
			for (const callback of frames.splice(0)) callback(0);
		});

		expect(canvas.scrollLeft).toBeCloseTo(107.8, 5);
		expect(canvas.scrollTop).toBeCloseTo(49, 5);
	});

	it("leaves zoom on the first reverse notch after an overshoot at the maximum", () => {
		useEditorStore.setState({ zoom: 3 });
		const { getByTestId } = render(<Canvas />);
		const canvas = getByTestId("canvas");

		wheel(canvas, { deltaY: -100, ctrlKey: true });
		expect(useEditorStore.getState().zoom).toBe(3);

		wheel(canvas, { deltaY: 100, ctrlKey: true });
		expect(useEditorStore.getState().zoom).toBe(2.46);
	});

	it("starts a fresh gesture when the zoom was set elsewhere", () => {
		const { getByTestId } = render(<Canvas />);
		const canvas = getByTestId("canvas");

		wheel(canvas, { deltaY: -1, ctrlKey: true });
		useEditorStore.setState({ zoom: 1.2 });
		wheel(canvas, { deltaY: -1, ctrlKey: true });

		expect(useEditorStore.getState().zoom).toBe(1.2);
	});

	it("keeps the zoom inside the editor's bounds, still without browser zoom", () => {
		useEditorStore.setState({ zoom: 3 });
		const { getByTestId } = render(<Canvas />);
		const event = wheel(getByTestId("canvas"), { deltaY: -100, ctrlKey: true });

		expect(event.defaultPrevented).toBe(true);
		expect(useEditorStore.getState().zoom).toBe(3);
	});

	it("stops at the minimum scale without zooming the browser", () => {
		useEditorStore.setState({ zoom: 0.6 });
		const { getByTestId } = render(<Canvas />);
		const event = wheel(getByTestId("canvas"), { deltaY: 100, ctrlKey: true });

		expect(event.defaultPrevented).toBe(true);
		expect(useEditorStore.getState().zoom).toBe(0.6);
	});

	it("does not enlarge a Fit that is already below the minimum", () => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(private readonly callback: ResizeObserverCallback) {}
				observe() {
					this.callback([{ contentRect: { width: 318 } } as ResizeObserverEntry], this as never);
				}
				disconnect() {}
			},
		);

		const { getByTestId } = render(<Canvas />);
		const event = wheel(getByTestId("canvas"), { deltaY: 100, ctrlKey: true });

		expect(event.defaultPrevented).toBe(true);
		expect(useEditorStore.getState().zoom).toBe("fit");
	});
});
