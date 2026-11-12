// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { HotkeyManager, HotkeysProvider, useHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { useRef } from "react";
import { KeyboardShortcuts } from ".";
import { useShortcutSettings } from "./settings";
import { showKeyboardShortcuts, useShortcutHelp, useShortcutsPage } from "./store";

beforeEach(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	useShortcutSettings.getState().setCharacterShortcuts(true);
});

afterEach(() => {
	cleanup();
	useShortcutHelp.getState().close();
	HotkeyManager.resetInstance();
});

function key(target: Element | Document, options: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", {
		key: "?",
		code: "Slash",
		shiftKey: true,
		bubbles: true,
		cancelable: true,
		...options,
	});
	act(() => {
		target.dispatchEvent(event);
	});
	act(() => {
		target.dispatchEvent(new KeyboardEvent("keyup", { key: event.key, code: event.code, bubbles: true }));
	});
	return event;
}

type PageProps = { editor?: boolean; run?: () => void };

function Page({ editor = false, run = () => {} }: PageProps) {
	const enabled = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey("N", run, { enabled, meta: { name: "New document" } });
	useHotkey("Mod+P", run, { enabled: editor, meta: { name: "Download PDF" } });
	useHotkey("Mod+K", run, { meta: { name: "Command palette" } });
	return (
		<>
			<button type="button">Page control</button>
			{/* The sidebar's Shortcuts row: the way in without a keyboard. */}
			<button type="button" onClick={(event) => showKeyboardShortcuts(event.currentTarget)}>
				Shortcuts
			</button>
			<input aria-label="Name" />
			<textarea aria-label="Notes" />
			<div contentEditable aria-label="Editor" />
			<KeyboardShortcuts />
		</>
	);
}

const page = (props: PageProps = {}) => (
	<I18nProvider i18n={i18n}>
		<HotkeysProvider defaultOptions={{ hotkey: { platform: "mac" } }}>
			<Page {...props} />
		</HotkeysProvider>
	</I18nProvider>
);

it("lists current registration names, suspends background actions, closes with ? and returns focus", async () => {
	const run = vi.fn();
	const view = render(page({ run }));
	const control = screen.getByRole("button", { name: "Page control" });
	control.focus();
	expect(key(control).defaultPrevented).toBe(true);
	const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
	expect(dialog.textContent).toContain("New document");
	expect(dialog.textContent).toContain("Command palette");
	expect(dialog.textContent).not.toContain("Download PDF");
	key(dialog, { key: "n", code: "KeyN", shiftKey: false });
	key(dialog, { key: "k", code: "KeyK", shiftKey: false, metaKey: true });
	expect(run).not.toHaveBeenCalled();
	key(dialog, { repeat: true });
	expect(screen.queryByRole("dialog")).not.toBeNull();
	key(dialog);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(control));
	view.rerender(page({ run, editor: true }));
	key(control);
	const editorDialog = await screen.findByRole("dialog");
	expect(editorDialog.textContent).toContain("Download PDF");
	key(editorDialog);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	act(() =>
		i18n.loadAndActivate({ locale: "de", messages: { "77Emn0": "Tastenkombinationen", "-rGgtX": "Diese Liste" } }),
	);
	key(control);
	const translated = await screen.findByRole("dialog", { name: "Tastenkombinationen" });
	expect(Array.from(translated.querySelectorAll("dt"), (element) => element.textContent)).toContain("Diese Liste");
});

it("leaves text entry, IME, modifier chords and other overlays alone", () => {
	render(page());
	for (const label of ["Name", "Notes", "Editor"]) {
		const input = screen.getByLabelText(label);
		input.focus();
		expect(key(input).defaultPrevented).toBe(false);
		expect(screen.queryByRole("dialog")).toBeNull();
	}
	const control = screen.getByRole("button", { name: "Page control" });
	control.focus();
	for (const options of [
		{ isComposing: true },
		{ keyCode: 229 },
		{ metaKey: true },
		{ ctrlKey: true },
		{ altKey: true },
	]) {
		expect(key(control, options).defaultPrevented).toBe(false);
		expect(screen.queryByRole("dialog")).toBeNull();
	}
	for (const slot of [
		"dialog-content",
		"sheet-content",
		"alert-dialog-content",
		"popover-content",
		"dropdown-menu-content",
		"context-menu-content",
	]) {
		const overlay = document.createElement("div");
		overlay.dataset.slot = slot;
		document.body.append(overlay);
		expect(key(control).defaultPrevented).toBe(false);
		expect(screen.queryByRole("dialog")).toBeNull();
		overlay.remove();
	}
});

it("offers a non-keyboard entry and persists the off switch without disabling modifier commands", async () => {
	const run = vi.fn();
	render(page({ run }));
	const trigger = screen.getByRole("button", { name: "Shortcuts" });
	trigger.focus();
	fireEvent.click(trigger);
	await screen.findByRole("dialog");
	fireEvent.click(screen.getByRole("switch", { name: "Single-character shortcuts" }));
	expect(localStorage.getItem("character-shortcuts")).toBe("off");
	fireEvent.click(screen.getByRole("button", { name: "Close" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await waitFor(() => expect(document.activeElement).toBe(trigger));
	expect(key(trigger).defaultPrevented).toBe(false);
	key(trigger, { key: "n", code: "KeyN", shiftKey: false });
	expect(run).not.toHaveBeenCalled();
	key(trigger, { key: "k", code: "KeyK", shiftKey: false, metaKey: true });
	expect(run).toHaveBeenCalledOnce();
	fireEvent.click(trigger);
	expect(await screen.findByRole("dialog")).toBeTruthy();
});

it("names the page, lists keys that need a focused row under On a row and folds a run of digit keys into one line", async () => {
	function RowPage() {
		useShortcutsPage("Applications");
		const row = useRef<HTMLAnchorElement>(null);
		useHotkey("N", () => {}, { meta: { name: "Save a job" } });
		useHotkeys(
			["Saved", "Applied", "Screening", "Interview", "Offer"].map((stage, index) => ({
				hotkey: `${index + 1}` as "1",
				callback: () => {},
				options: { meta: { name: `Move to ${stage}` } },
			})),
			{ target: row },
		);
		return (
			<>
				<a ref={row} href="#lumen">
					Lumen
				</a>
				<button type="button" onClick={(event) => showKeyboardShortcuts(event.currentTarget)}>
					Shortcuts
				</button>
				<KeyboardShortcuts />
			</>
		);
	}
	render(
		<I18nProvider i18n={i18n}>
			<HotkeysProvider defaultOptions={{ hotkey: { platform: "mac" } }}>
				<RowPage />
			</HotkeysProvider>
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
	const dialog = await screen.findByRole("dialog", { name: "Shortcuts on Applications" });
	const rows = within(dialog).getByRole("region", { name: "On a row" });
	expect(Array.from(rows.querySelectorAll("dt"), (element) => element.textContent)).toEqual(["Move to Saved … Offer"]);
	expect(rows.querySelector("dd")?.textContent).toBe("1–5");
	expect(Array.from(dialog.querySelectorAll("dt"), (element) => element.textContent)).toContain("Save a job");
});
