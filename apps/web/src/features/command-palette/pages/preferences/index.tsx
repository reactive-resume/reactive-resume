import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { CommandItem, CommandShortcut } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { useCommandPaletteStore } from "../../store";
import { RowNote } from "../base";
import { LanguageCommandPage } from "./language";
import { ThemeCommandPage } from "./theme";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { showKeyboardShortcuts } from "@/features/keyboard-shortcuts/store";
import { getLocaleOptions } from "@/features/locale/locale-options";

/** Close the palette first: the shortcut list captures the page's own shortcuts, not the palette's. */
export function openShortcutsFromPalette() {
	useCommandPaletteStore.getState().setOpen(false);
	requestAnimationFrame(() => showKeyboardShortcuts());
}

/** Keyboard shortcuts, and the two preferences worth a command: each opens a second step listing its choices. */
export function PreferenceItems() {
	const { i18n } = useLingui();
	const pushPage = useCommandPaletteStore((state) => state.pushPage);
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	const language = getLocaleOptions().find((option) => option.value === i18n.locale)?.label;

	return (
		<>
			<CommandItem value="preferences.shortcuts" onSelect={openShortcutsFromPalette}>
				<Icon name="keyboard" />
				<Trans>Keyboard shortcuts</Trans>
				{characterShortcuts && (
					<CommandShortcut>
						<Kbd>?</Kbd>
					</CommandShortcut>
				)}
			</CommandItem>
			<CommandItem value="preferences.theme" onSelect={() => pushPage("theme")}>
				<Icon name="palette" />
				<Trans>Change theme to…</Trans>
				<RowNote>
					<Trans>Light · Dark · System</Trans>
				</RowNote>
			</CommandItem>
			<CommandItem value="preferences.language" onSelect={() => pushPage("language")}>
				<Icon name="translate" />
				<Trans>Change language to…</Trans>
				{language && <RowNote>{language}</RowNote>}
			</CommandItem>
		</>
	);
}

/** The second steps: the theme and language choices. */
export function PreferencePages() {
	return (
		<>
			<ThemeCommandPage />
			<LanguageCommandPage />
		</>
	);
}
