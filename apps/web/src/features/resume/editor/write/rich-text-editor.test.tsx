// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { RichTextEditor } from "./rich-text-editor";

const mocks = vi.hoisted(() => ({ mobile: false }));
vi.mock("@reactive-resume/ui/hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile }));
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
		if (mobile)
			await act(async () => {
				bold.focus();
			});
		else await userEvent.tab();
		expect(document.activeElement).toBe(bold);
		expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeDefined();
		await userEvent.keyboard("{Enter}");
		expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
		await act(async () => {
			screen.getByRole("button", { name: "Outside" }).focus();
		});
		expect(screen.queryByRole("toolbar")).toBeNull();
	},
);
