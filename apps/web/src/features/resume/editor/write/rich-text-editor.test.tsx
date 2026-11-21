// @vitest-environment happy-dom
import { act, render, screen, within } from "@testing-library/react";
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
		// Desktop keeps formatting above the text; phones dock it only while editing.
		expect(screen.queryByRole("toolbar") !== null).toBe(!mobile);
	},
);

it("shows the placeholder only for empty content before the field receives focus", async () => {
	mocks.mobile = false;
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
	// Desktop shows formatting and the footer around filled text before focus too.
	expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
	expect(screen.getByText("Markdown shortcuts on")).toBeVisible();
	expect(screen.queryByText("Improve works on a line once you have written one.")).toBeNull();
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

it("opens More formatting without writing content or losing the editor", async () => {
	mocks.mobile = false;
	i18n.load("en", {});
	i18n.activate("en");
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<RichTextEditor label="Description" value="<p>Existing line</p>" onChange={onChange} />
		</I18nProvider>,
	);
	const editor = await screen.findByRole("textbox", { name: "Description" });
	await act(async () => editor.focus());
	await userEvent.click(screen.getByRole("button", { name: "More formatting" }));
	expect(await screen.findByRole("menu")).toBeVisible();
	expect(screen.getByText("Text color")).toBeVisible();
	expect(screen.getByRole("menuitemradio", { name: "Heading 1" })).toBeVisible();
	expect(onChange).not.toHaveBeenCalled();
});

it("hides the placeholder and counts characters as soon as typing starts", async () => {
	mocks.mobile = false;
	i18n.load("en", {});
	i18n.activate("en");
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<RichTextEditor label="Description" value="" placeholder="Describe your work" onChange={vi.fn()} />
		</I18nProvider>,
	);
	const view = within(container);
	const editor = await view.findByRole("textbox", { name: "Description" });
	expect(view.getByText("Describe your work")).toBeVisible();
	await userEvent.click(editor);
	await userEvent.keyboard("Hello");
	expect(editor.textContent).toBe("Hello");
	expect(view.queryByText("Describe your work")).toBeNull();
	// happy-dom's click leaves an extra empty paragraph, which Tiptap counts, so only check the count moved off 0.
	expect(container.textContent).not.toMatch(/\b0 characters/);
});
