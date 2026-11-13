import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

let width = 834;
const listeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;

afterEach(() => {
	window.matchMedia = originalMatchMedia;
	listeners.clear();
});

it("keeps a side sheet beside tablets and moves it below phone content", async () => {
	window.matchMedia = vi.fn((query: string) => ({
		matches: width >= Number(/min-width: (\d+)px/.exec(query)?.[1] ?? 0),
		media: query,
		addEventListener: (_: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
	})) as unknown as typeof window.matchMedia;
	render(
		<Sheet open>
			<SheetContent closeLabel="Close">
				<SheetTitle>Details</SheetTitle>
			</SheetContent>
		</Sheet>,
	);
	const dialog = await screen.findByRole("dialog", { name: "Details" });
	expect(dialog).toHaveAttribute("data-side", "right");
	act(() => {
		width = 390;
		for (const listener of listeners) listener();
	});
	expect(dialog).toHaveAttribute("data-side", "bottom");
	expect(dialog.querySelector('[aria-hidden="true"]')).toBeTruthy();
});
