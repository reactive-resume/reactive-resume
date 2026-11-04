// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { Slider } from "./slider";

afterEach(cleanup);

it("names the actual standalone range input and updates its label", () => {
	const view = render(<Slider value={[1]} min={1} max={3} aria-label="Zoom" />);
	// Happy DOM has no track geometry; browser coverage verifies the thumb's visibility.
	const input = view.container.querySelector('input[type="range"]');
	expect(input).toHaveAttribute("aria-label", "Zoom");
	view.rerender(<Slider value={[1]} min={1} max={3} aria-label="Vergrößern" />);
	expect(input).toHaveAttribute("aria-label", "Vergrößern");
});

it("keeps a range group's label without assigning it to both endpoints", () => {
	const view = render(<Slider defaultValue={[20, 80]} aria-label="Selected range" data-testid="range" />);
	expect(screen.getByTestId("range")).toHaveAccessibleName("Selected range");
	const inputs = view.container.querySelectorAll('input[type="range"]');
	expect(inputs).toHaveLength(2);
	for (const input of inputs) expect(input.getAttribute("aria-label")).toBeNull();
});
