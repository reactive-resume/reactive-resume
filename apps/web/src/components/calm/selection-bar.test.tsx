// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { TooltipProvider } from "@reactive-resume/ui/components/tooltip";
import { SelectionBar } from "./selection-bar";

i18n.loadAndActivate({ locale: "en", messages: {} });

const mount = (onClear: () => void, onSelectAll = () => {}) =>
	render(
		<I18nProvider i18n={i18n}>
			<TooltipProvider>
				<SelectionBar label="Selected documents" count={2} total={5} onSelectAll={onSelectAll} onClear={onClear}>
					<div role="menu">
						<button type="button">Tags…</button>
					</div>
				</SelectionBar>
			</TooltipProvider>
		</I18nProvider>,
	);

it("clears the selection on Escape, but leaves Escape to an open menu", () => {
	const onClear = vi.fn();
	mount(onClear);

	fireEvent.keyDown(screen.getByRole("button", { name: "Tags…" }), { key: "Escape" });
	expect(onClear).not.toHaveBeenCalled();

	fireEvent.keyDown(document.body, { key: "Escape" });
	expect(onClear).toHaveBeenCalledTimes(1);
});

it("names the toolbar, counts the selection and offers the rest", () => {
	const onSelectAll = vi.fn();
	mount(() => {}, onSelectAll);

	expect(screen.getByRole("toolbar", { name: "Selected documents" }).textContent).toContain("2 selected");
	fireEvent.click(screen.getByRole("button", { name: "Select all 5" }));
	expect(onSelectAll).toHaveBeenCalledTimes(1);
});
