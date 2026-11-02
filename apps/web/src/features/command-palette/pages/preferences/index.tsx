import { Trans } from "@lingui/react/macro";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useCommandPaletteStore } from "../../store";
import { BaseCommandGroup } from "../base";
import { LanguageCommandPage } from "./language";
import { ThemeCommandPage } from "./theme";
import { showKeyboardShortcuts } from "@/features/keyboard-shortcuts/store";

export function PreferencesCommandGroup() {
	const pushPage = useCommandPaletteStore((state) => state.pushPage);

	return (
		<>
			<BaseCommandGroup heading={<Trans>Preferences</Trans>}>
				<CommandItem
					onSelect={() => {
						useCommandPaletteStore.getState().setOpen(false);
						requestAnimationFrame(() => showKeyboardShortcuts());
					}}
				>
					<Icon name="keyboard" size={16} />
					<Trans>Keyboard shortcuts</Trans>
				</CommandItem>
				<CommandItem onSelect={() => pushPage("theme")}>
					<Icon name="palette" size={16} />
					<Trans>Change theme to…</Trans>
				</CommandItem>

				<CommandItem onSelect={() => pushPage("language")}>
					<Icon name="translate" size={16} />
					<Trans>Change language to…</Trans>
				</CommandItem>
			</BaseCommandGroup>

			<ThemeCommandPage />
			<LanguageCommandPage />
		</>
	);
}
