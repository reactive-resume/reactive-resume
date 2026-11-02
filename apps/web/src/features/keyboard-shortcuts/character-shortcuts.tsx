import { useLingui } from "@lingui/react/macro";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { useShortcutSettings } from "./settings";

export function CharacterShortcutSetting() {
	const { t } = useLingui();
	const { characterShortcuts, setCharacterShortcuts } = useShortcutSettings();
	return (
		<SwitchRow
			label={t`Single-character shortcuts`}
			description={t`Allow keys such as ?, N, / and editor mode numbers outside text fields. Turn off when using speech input.`}
			checked={characterShortcuts}
			onCheckedChange={setCharacterShortcuts}
		/>
	);
}
