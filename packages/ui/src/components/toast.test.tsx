import type { MouseEvent } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { Toaster, toast } from "./toast";

// Base UI adds this to the events it merges handlers for.
type BaseUIClick = MouseEvent<HTMLButtonElement> & { preventBaseUIHandler: () => void };

const show = (onClick: (event: BaseUIClick) => void) =>
	act(() => {
		toast.add({
			description: "Section cleared",
			actionProps: { children: "Undo", onClick: (event) => onClick(event as BaseUIClick) },
		});
	});

describe("Toast action", () => {
	it("runs once and closes the toast, even when pressed again while it leaves", async () => {
		const undo = vi.fn();
		render(<Toaster />);
		show(undo);

		const action = screen.getByRole("button", { name: "Undo" });
		act(() => {
			fireEvent.click(action);
			fireEvent.click(action);
		});
		action.focus();
		await userEvent.keyboard("{Enter}");

		expect(undo).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.queryByText("Section cleared")).toBeNull());
	});

	it("stays open, and can run again, when its handler keeps it", async () => {
		const keep = vi.fn((event: BaseUIClick) => event.preventBaseUIHandler());
		render(<Toaster />);
		show(keep);

		const action = screen.getByRole("button", { name: "Undo" });
		await userEvent.click(action);
		await userEvent.click(action);

		expect(keep).toHaveBeenCalledTimes(2);
		expect(screen.getByText("Section cleared")).toBeInTheDocument();
		act(() => toast.close());
	});
});
