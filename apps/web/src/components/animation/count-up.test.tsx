// @vitest-environment happy-dom

import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { domAnimation, LazyMotion } from "motion/react";

const reducedMotion = vi.hoisted(() => ({ value: false }));

vi.mock("motion/react", async (importOriginal) => ({
	...(await importOriginal<typeof import("motion/react")>()),
	useReducedMotion: () => reducedMotion.value,
}));

const { CountUp } = await import("./count-up");

describe("CountUp", () => {
	it("starts at 0 before animating", () => {
		reducedMotion.value = false;
		const { container } = render(<CountUp to={1234} />);
		expect(container.querySelector("span")?.textContent).toBe("0");
	});

	it("jumps to the final grouped value under reduced motion", async () => {
		reducedMotion.value = true;
		const { container } = render(
			<LazyMotion features={domAnimation}>
				<CountUp to={1234} />
			</LazyMotion>,
		);
		await waitFor(() => expect(container.querySelector("span")?.textContent).toBe("1,234"));
	});

	it("forwards className and aria-hidden", () => {
		reducedMotion.value = false;
		const { container } = render(<CountUp to={100} className="custom-class" aria-hidden="true" />);
		const span = container.querySelector("span") as HTMLSpanElement;
		expect(span.className).toContain("custom-class");
		expect(span.getAttribute("aria-hidden")).toBe("true");
	});
});
