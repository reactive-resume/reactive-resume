import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Sheet", () => {
	it.each(["top", "right", "bottom", "left"] as const)(
		"opens and closes a %s sheet without Base UI warnings",
		async (side) => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {});
			const onOpenChange = vi.fn();
			render(
				<Sheet defaultOpen onOpenChange={onOpenChange}>
					<SheetContent side={side}>
						<SheetTitle>Share resume</SheetTitle>
						<SheetDescription>Choose how to share your resume.</SheetDescription>
					</SheetContent>
				</Sheet>,
			);

			expect(screen.getByRole("dialog", { name: "Share resume" })).toBeVisible();
			expect(error).not.toHaveBeenCalled();
			await userEvent.click(screen.getByRole("button", { name: "Close" }));
			expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
		},
	);
});
