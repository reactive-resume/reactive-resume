// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { useState } from "react";
import { Tabs } from "@reactive-resume/ui/components/tabs";
import { EditorFrame, PanelResizer } from "./shell";
import { useEditorStore } from "@/features/resume/editor/store";

vi.mock("@/features/assistant/dock", () => ({ AssistantOverlay: () => null }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));

function Harness({ initial }: { initial: number }) {
	const [width, setWidth] = useState(initial);
	return <PanelResizer width={width} onResize={setWidth} onCommit={setWidth} />;
}

const renderResizer = (initial: number) => {
	i18n.load("en", {});
	i18n.activate("en");
	return render(
		<I18nProvider i18n={i18n}>
			<Harness initial={initial} />
		</I18nProvider>,
	);
};

afterEach(() => {
	vi.useRealTimers();
});

it("shows the panel's share of the screen while resizing with the keyboard, then hides it", async () => {
	window.innerWidth = 1200;
	const { container } = renderResizer(400);
	const separator = screen.getByRole("separator", { name: "Resize panel" });
	expect(separator).toHaveAttribute("aria-valuetext", "33% of the screen");
	expect(container.textContent).not.toContain("%");

	vi.useFakeTimers({ shouldAdvanceTime: true });
	separator.focus();
	await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
	// 400 + 96 = 496px of 1200px.
	expect(separator).toHaveAttribute("aria-valuenow", "496");
	expect(separator).toHaveAttribute("aria-valuetext", "41% of the screen");
	expect(container.textContent).toContain("41%");

	await act(async () => {
		vi.advanceTimersByTime(1000);
	});
	expect(container.textContent).not.toContain("41%");
});

it("reports the width the panel actually has when the window is too narrow for the saved width", () => {
	window.innerWidth = 1000;
	renderResizer(900);
	// The page keeps 480px, so the panel is 520px of 1000px.
	const separator = screen.getAllByRole("separator", { name: "Resize panel" }).at(-1);
	expect(separator).toHaveAttribute("aria-valuenow", "520");
	expect(separator).toHaveAttribute("aria-valuetext", "52% of the screen");
});

it("hides the splitter while the template gallery owns the panel's width, and restores it afterwards", async () => {
	window.innerWidth = 1200;
	i18n.load("en", {});
	i18n.activate("en");
	const layout = { layout: "desktop", pinnable: false, pinned: false, assistantPlace: "replace" } as const;
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<Tabs value="design">
				<EditorFrame
					editorLayout={layout}
					bar={null}
					mode="design"
					panelLabel="Design"
					panel={<p>Design panel</p>}
					page={<p>Page</p>}
					assistant={null}
					mobile={null}
				>
					{null}
				</EditorFrame>
			</Tabs>
		</I18nProvider>,
	);
	const slot = container.querySelector<HTMLElement>("#editor-panel")?.parentElement;
	expect(slot?.style.getPropertyValue("--editor-panel")).toContain("400px");
	expect(screen.queryByRole("separator", { name: "Resize panel" })).not.toBeNull();

	await act(async () => {
		useEditorStore.setState({ panelWide: true });
	});
	expect(slot?.style.getPropertyValue("--editor-panel")).toBe("clamp(380px, 65vw, 936px)");
	expect(screen.queryByRole("separator", { name: "Resize panel" })).toBeNull();

	await act(async () => {
		useEditorStore.setState({ panelWide: false });
	});
	expect(slot?.style.getPropertyValue("--editor-panel")).toContain("400px");
	expect(screen.queryByRole("separator", { name: "Resize panel" })).not.toBeNull();
});
