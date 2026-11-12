import { useLingui } from "@lingui/react/macro";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { useShortcutSettings } from "./settings";

export function CharacterShortcutSetting() {
	const { t } = useLingui();
	const { characterShortcuts, setCharacterShortcuts } = useShortcutSettings();
	return (
		<SwitchRow
			label={t`Single-character shortcuts`}
			description={t`Keys such as ?, N, / and 1 to 4 work outside text fields. Turn this off if you use speech input.`}
			checked={characterShortcuts}
			onCheckedChange={setCharacterShortcuts}
		/>
	);
}
