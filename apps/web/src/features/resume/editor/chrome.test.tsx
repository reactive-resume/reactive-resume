// @vitest-environment happy-dom

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { usePageScale } from "./chrome";
import { useEditorStore } from "./store";

function Canvas() {
	const { canvasRef } = usePageScale("a4");
	return <section ref={canvasRef} data-testid="canvas" />;
}

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

	it("keeps the zoom inside the editor's bounds, still without browser zoom", () => {
		useEditorStore.setState({ zoom: 3 });
		const { getByTestId } = render(<Canvas />);
		const event = wheel(getByTestId("canvas"), { deltaY: -100, ctrlKey: true });

		expect(event.defaultPrevented).toBe(true);
		expect(useEditorStore.getState().zoom).toBe(3);
	});
});
