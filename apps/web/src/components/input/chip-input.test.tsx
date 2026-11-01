// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ChipInput } from "./chip-input";
import { loadLocale } from "@/libs/locale";

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it("keeps commas in new and edited keywords and saves on Enter", () => {
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput allowCommas defaultValue={["Existing"]} onChange={onChange} />
		</I18nProvider>,
	);
	const input = screen.getByRole("textbox", { name: "Add keyword" });
	fireEvent.change(input, { target: { value: "Systems, distributed" } });
	expect(onChange).not.toHaveBeenCalled();
	fireEvent.keyDown(input, { key: "," });
	expect(onChange).not.toHaveBeenCalled();
	fireEvent.keyDown(input, { key: "Enter" });
	expect(onChange).toHaveBeenLastCalledWith(["Existing", "Systems, distributed"]);
	fireEvent.click(screen.getByRole("button", { name: "Edit Existing" }));
	const editor = screen.getByRole("textbox", { name: "Edit keyword" });
	onChange.mockClear();
	fireEvent.change(editor, { target: { value: "Existing, revised" } });
	expect(onChange).not.toHaveBeenCalled();
	fireEvent.keyDown(editor, { key: "Enter" });
	expect(onChange).toHaveBeenLastCalledWith(["Existing, revised", "Systems, distributed"]);
});

it("retains comma-separated bulk entry for tags", () => {
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput onChange={onChange} />
		</I18nProvider>,
	);
	const input = screen.getByRole("textbox", { name: "Add keyword" });
	fireEvent.change(input, { target: { value: "first,second," } });
	expect(onChange).toHaveBeenLastCalledWith(["first", "second"]);
});

const liveRegion = () => document.querySelector('[id^="DndLiveRegion"]');

// Moving between keywords needs real layout, so the browser tests cover it; happy-dom covers what's read out.
it("announces keyword drags by name, and explains the keyboard controls", async () => {
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput defaultValue={["Alpha", "Beta", "Gamma"]} onChange={onChange} />
		</I18nProvider>,
	);
	const alpha = screen.getByText("Alpha").closest<HTMLElement>('[role="button"]');
	if (!alpha) throw new Error("Alpha isn't draggable");
	expect(document.getElementById(alpha.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
		"To pick it up, press Space or Enter. Use the arrow keys to move it, Space or Enter to drop it, or Escape to cancel.",
	);

	alpha.focus();
	fireEvent.keyDown(alpha, { code: "Space" });
	await waitFor(() => expect(liveRegion()?.textContent).toBe("Picked up Alpha."));
	fireEvent.keyDown(alpha, { code: "Escape" });
	await waitFor(() => expect(liveRegion()?.textContent).toBe("Moving Alpha was cancelled. Nothing moved."));

	fireEvent.keyDown(alpha, { code: "Space" });
	await waitFor(() => expect(liveRegion()?.textContent).toBe("Picked up Alpha."));
	fireEvent.keyDown(alpha, { code: "Space" });
	await waitFor(() => expect(liveRegion()?.textContent).toBe("Alpha was dropped where it started. Nothing moved."));
	expect(onChange).not.toHaveBeenCalled();
});

it("announces keyword drags in German when German is the UI language", async () => {
	await loadLocale("de-DE");
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput defaultValue={["Alpha", "Beta"]} />
		</I18nProvider>,
	);
	const alpha = screen.getByText("Alpha").closest<HTMLElement>('[role="button"]');
	if (!alpha) throw new Error("Alpha isn't draggable");
	alpha.focus();
	fireEvent.keyDown(alpha, { code: "Space" });
	await waitFor(() => expect(liveRegion()?.textContent).toBe("Alpha aufgenommen."));
	fireEvent.keyDown(alpha, { code: "Escape" });
	await waitFor(() =>
		expect(liveRegion()?.textContent).toBe("Verschieben von Alpha abgebrochen. Nichts wurde verschoben."),
	);
	await loadLocale("en-US");
});
