// @vitest-environment happy-dom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spotlight } from "./spotlight";

describe("Spotlight", () => {
	it("renders a non-pointer-events overlay container", () => {
		const { container } = render(<Spotlight />);
		const wrapper = container.firstChild as HTMLElement;
		expect(wrapper.className).toContain("pointer-events-none");
		expect(wrapper.className).toContain("absolute");
	});

	it("renders both left and right beam groups by default", () => {
		const { container } = render(<Spotlight />);
		// Outer wrapper > two animated beam containers
		const beamGroups = container.firstChild?.childNodes;
		expect(beamGroups?.length).toBe(2);
	});
});
