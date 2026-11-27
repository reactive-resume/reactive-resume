// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { RichTextEditor } from "./rich-text-editor";

const mocks = vi.hoisted(() => ({ mobile: false }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({
	useBreakpoint: () => (mocks.mobile ? "mobile" : "desktop"),
}));
// The editor never finishes loading here, so the preview stays on screen.
vi.mock("./rich-text-editor-field", () => ({
	RichTextEditor: () => {
		throw new Promise(() => {});
	},
}));

const renderPreview = (value: string) => {
	i18n.load("en", {});
	i18n.activate("en");
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<RichTextEditor label="Description" value={value} onChange={vi.fn()} />
		</I18nProvider>,
	);
	return container;
};

it.each([
	[false, ["max-h-[540px]", "min-h-50"]],
	[true, ["max-h-[360px]", "min-h-11"]],
])("sizes the loading preview like the editor (mobile=%s)", (mobile, height) => {
	mocks.mobile = mobile;
	const preview = renderPreview("<p>Existing line</p>").querySelector("[aria-busy=true]");
	expect(Array.from(preview?.classList ?? []).filter((name) => /^(max|min)-h-/.test(name))).toEqual(height);
});

it("reserves no toolbar or footer space for read-only table content", () => {
	mocks.mobile = false;
	const container = renderPreview(
		"<table><thead><tr><th>Year</th></tr></thead><tbody><tr><td>2024</td></tr></tbody></table>",
	);
	expect(container.querySelector("[role=status]")).not.toBeNull();
	expect(container.querySelectorAll("[aria-hidden=true]")).toHaveLength(0);
});
