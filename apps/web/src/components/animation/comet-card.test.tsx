// @vitest-environment happy-dom

import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CometCard } from "./comet-card";

describe("CometCard", () => {
	it("renders its children inside the perspective wrapper", () => {
		const { getByText } = render(
			<CometCard>
				<span>card body</span>
			</CometCard>,
		);
		expect(getByText("card body")).toBeInTheDocument();
	});

	it("merges custom className into the wrapper", () => {
		const { container } = render(
			<CometCard className="extra-class">
				<span>x</span>
			</CometCard>,
		);
		const wrapper = container.firstChild as HTMLElement;
		expect(wrapper.className).toContain("extra-class");
		expect(wrapper.className).toContain("perspective-distant");
		expect(wrapper.className).toContain("transform-3d");
	});

	it("renders a glare overlay positioned absolutely with mix-blend-overlay", () => {
		const { container } = render(
			<CometCard>
				<span>x</span>
			</CometCard>,
		);
		const glare = container.querySelector("[class*='mix-blend-overlay']") as HTMLElement | null;
		expect(glare).not.toBeNull();
		expect(glare?.className).toContain("pointer-events-none");
	});

	it("does not throw when pointer moves over / leaves the card", () => {
		const { container } = render(
			<CometCard>
				<span>x</span>
			</CometCard>,
		);

		const tiltable = container.querySelector("[class*='rounded-md']") as HTMLElement;
		expect(tiltable).toBeTruthy();

		expect(() => {
			fireEvent.pointerMove(tiltable, { clientX: 100, clientY: 50, pointerType: "mouse" });
			fireEvent.pointerMove(tiltable, { clientX: 0, clientY: 0, pointerType: "mouse" });
			fireEvent.pointerLeave(tiltable);
		}).not.toThrow();
	});
});
