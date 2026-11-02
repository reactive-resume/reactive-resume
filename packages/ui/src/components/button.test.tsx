import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { Button } from "./button";

describe("Button", () => {
	it("shows a spinner, sets aria-busy and ignores clicks while loading", async () => {
		const onClick = vi.fn();
		render(
			<Button loading onClick={onClick}>
				Preparing…
			</Button>,
		);
		const button = screen.getByRole("button", { name: "Preparing…" });
		expect(button).toHaveAttribute("aria-busy", "true");
		expect(button.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
		await userEvent.click(button);
		expect(onClick).not.toHaveBeenCalled();
	});
});

it("stays a link when it renders one", () => {
	render(
		<Button nativeButton={false} render={<a href="/somewhere" />}>
			Go somewhere
		</Button>,
	);
	expect(screen.getByRole("link", { name: "Go somewhere" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Go somewhere" })).toBeNull();
});
