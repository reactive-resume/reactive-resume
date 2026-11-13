import { useLingui } from "@lingui/react/macro";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { useShortcutSettings } from "./settings";

export function CharacterShortcutSetting() {
	const { t } = useLingui();
	const { characterShortcuts, setCharacterShortcuts } = useShortcutSettings();
	return (
		<SwitchRow
			label={t`Single-key shortcuts`}
			description={t`Turn off if you use speech input. Shortcuts with ⌘ keep working.`}
			checked={characterShortcuts}
			onCheckedChange={setCharacterShortcuts}
		/>
	);
}
