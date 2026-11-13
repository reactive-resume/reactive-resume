// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { TagChips } from "./tag-chips";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("leaves out whole tags that do not fit and restores their keyboard access when space grows", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	let available = 100;
	let resize = () => {};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				resize = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => available);
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
		return { width: this.textContent === "Design systems" ? 110 : 48 } as DOMRect;
	});
	render(<TagChips fit tags={["Design systems", "Hybrid"]} onSelect={vi.fn()} />);
	expect(screen.queryByRole("button")).not.toBeInTheDocument();
	const tags = screen.getAllByRole("button", { hidden: true });
	expect(tags.map((tag) => tag.textContent)).toEqual(["Design systems", "Hybrid"]);
	expect(tags.every((tag) => tag.tabIndex === -1)).toBe(true);
	available = 200;
	act(() => resize());
	expect(screen.getByRole("button", { name: "Filter by Design systems" })).toBeVisible();
	expect(screen.getByRole("button", { name: "Filter by Hybrid" })).toHaveProperty("tabIndex", 0);
});
