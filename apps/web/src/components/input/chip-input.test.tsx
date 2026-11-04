// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createRef } from "react";
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
	expect(screen.queryByText("1", { exact: true })).toBeNull();
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

it("offers existing tags without repeating selections and keeps them keyboard and touch reachable", () => {
	const onChange = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput
				defaultValue={["Design"]}
				suggestions={["Design", "Remote", "Support"]}
				suggestionsLabel="Your tags"
				onChange={onChange}
			/>
		</I18nProvider>,
	);
	expect(screen.getByText("Your tags")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Add Design" })).toBeNull();
	const remote = screen.getByRole("button", { name: "Add Remote" });
	expect(remote).toHaveProperty("type", "button");
	expect(remote.tabIndex).toBe(0);

	const input = screen.getByRole("textbox", { name: "Add keyword" });
	fireEvent.change(input, { target: { value: "sup" } });
	expect(screen.getByRole("button", { name: "Add Support" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Add Remote" })).toBeNull();
	fireEvent.change(input, { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "Add Remote" }));
	expect(onChange).toHaveBeenLastCalledWith(["Design", "Remote"]);
	expect(screen.queryByRole("button", { name: "Add Remote" })).toBeNull();
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

it("explicit Save commits an edited tag and preserves duplicate and Escape behavior", () => {
	const commitRef = createRef<() => string[]>();
	const saved = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput defaultValue={["Alpha", "Beta"]} commitRef={commitRef} />
			<button onClick={() => saved(commitRef.current?.())}>Save tags</button>
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Edit Alpha" }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: " Revised " } });
	fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
	expect(saved).toHaveBeenLastCalledWith(["Revised", "Beta"]);
	fireEvent.click(screen.getByRole("button", { name: "Edit Revised" }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Beta" } });
	fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
	expect(saved).toHaveBeenLastCalledWith(["Revised", "Beta"]);
	fireEvent.click(screen.getByRole("button", { name: "Edit Revised" }));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Cancelled" } });
	fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
	fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
	expect(saved).toHaveBeenLastCalledWith(["Revised", "Beta"]);
});

it.each([false, true])("selecting a filtered suggestion consumes its draft before Save (editing=%s)", (editing) => {
	const commitRef = createRef<() => string[]>();
	const saved = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<ChipInput defaultValue={["Design"]} suggestions={["Remote"]} commitRef={commitRef} />
			<button onClick={() => saved(commitRef.current?.())}>Save tags</button>
		</I18nProvider>,
	);
	if (editing) fireEvent.click(screen.getByRole("button", { name: "Edit Design" }));
	const input = screen.getByRole("textbox");
	fireEvent.change(input, { target: { value: "rem" } });
	fireEvent.click(screen.getByRole("button", { name: "Add Remote" }));
	expect(input).toHaveValue("");
	expect(document.activeElement).toBe(input);
	fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
	expect(saved).toHaveBeenLastCalledWith(editing ? ["Remote"] : ["Design", "Remote"]);
});
