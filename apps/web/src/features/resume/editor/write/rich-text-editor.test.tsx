// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { RichTextEditor } from "./rich-text-editor-field";

const mocks = vi.hoisted(() => ({ mobile: false }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({
	useBreakpoint: () => (mocks.mobile ? "mobile" : "desktop"),
}));
vi.mock("@reactive-resume/ui/hooks/use-keyboard-inset", () => ({ useKeyboardInset: () => 0 }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: false }),
}));
vi.mock("@/hooks/use-confirm", () => ({ usePrompt: () => vi.fn() }));
vi.mock("./improve", () => ({ lineAtCaret: () => null, ImprovePanel: () => null }));

it.each([false, true])(
	"retains formatting controls while keyboard focus enters the toolbar (mobile=%s)",
	async (mobile) => {
		mocks.mobile = mobile;
		i18n.load("en", {});
		i18n.activate("en");
		render(
			<I18nProvider i18n={i18n}>
				<RichTextEditor label="Summary" value="<p>Example</p>" onChange={vi.fn()} />
				<button type="button">Outside</button>
			</I18nProvider>,
		);
		const editor = await screen.findByRole("textbox", { name: "Summary" });
		await act(async () => {
			editor.focus();
		});
		const bold = screen.getByRole("button", { name: "Bold" });
		await userEvent.tab();
		expect(document.activeElement).toBe(bold);
		const toolbar = screen.getByRole("toolbar", { name: "Formatting" });
		expect(Array.from(toolbar.querySelectorAll("button")).filter((button) => button.tabIndex === 0).length).toBe(1);
		await userEvent.keyboard("{ArrowRight}");
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Italic" }));
		await userEvent.keyboard("{Enter}");
		expect(screen.getByRole("button", { name: "Italic" }).getAttribute("aria-pressed")).toBe("true");
		await act(async () => {
			editor.focus();
		});
		await userEvent.tab();
		expect(toolbar.contains(document.activeElement)).toBe(true);
		await userEvent.tab();
		expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
		expect(screen.queryByRole("toolbar")).toBeNull();
	},
);

it("shows the placeholder only for empty content before the field receives focus", async () => {
	i18n.load("en", {});
	i18n.activate("en");
	render(
		<I18nProvider i18n={i18n}>
			<RichTextEditor
				label="Description"
				value="<ul><li><p>Existing line</p></li></ul>"
				placeholder="Describe your work"
				onChange={vi.fn()}
			/>
		</I18nProvider>,
	);
	await screen.findByRole("textbox", { name: "Description" });
	expect(screen.queryByText("Describe your work")).toBeNull();
});

it("keeps empty desktop entry formatting visible before typing, with Improve disabled", async () => {
	mocks.mobile = false;
	i18n.load("en", {});
	i18n.activate("en");
	render(
		<I18nProvider i18n={i18n}>
			<RichTextEditor label="Description" value="" onChange={vi.fn()} />
		</I18nProvider>,
	);
	await screen.findByRole("textbox", { name: "Description" });
	expect(await screen.findByRole("toolbar", { name: "Formatting" })).toBeVisible();
	expect(screen.getByRole("button", { name: "Improve" })).toHaveAttribute("aria-disabled", "true");
	expect(screen.getByText("Improve works on a line once you have written one.")).toBeVisible();
});
