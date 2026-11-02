import type { Locale } from "@reactive-resume/utils/locale";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { edit } from "./hooks";
import { Picker } from "@/features/design/picker";
import { localeMap } from "@/features/settings/locale-names";
import { selectableLocales } from "@/i18n";
import { Icon, Sheet, Text, useTheme } from "@/ui";

type ResumeLanguageProps = { locale: string; locked: boolean };

/**
 * The resume's own language, at the top of Write: a new resume takes the app's language, which is easy to miss when
 * writing in another one. The same setting as Design → Page → Language.
 */
export function ResumeLanguage({ locale, locked }: ResumeLanguageProps) {
	const { t, i18n } = useLingui();
	const { colors, space } = useTheme();
	const [open, setOpen] = useState(false);
	const languageName = (code: string) => (code in localeMap ? i18n._(localeMap[code as Locale]) : code);
	const label = t({
		comment: "Label beside the picker for the language a resume's headings and dates print in",
		message: "Resume language",
	});

	return (
		<>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={label}
				accessibilityValue={{ text: languageName(locale) }}
				accessibilityHint={t`Changes section titles and date words only, not your content.`}
				disabled={locked}
				onPress={() => setOpen(true)}
				style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}
			>
				<Text variant="micro" color="ink3">
					{label}
				</Text>
				<Text variant="micro" color={locked ? "ink3" : "accentText"}>
					{languageName(locale)}
				</Text>
				{locked ? null : <Icon name="caret-down" size={12} color={colors.accentText} />}
			</Pressable>
			<Sheet open={open} onClose={() => setOpen(false)} title={label} detents={[0.7, 1]}>
				<View style={{ flex: 1 }}>
					<Picker
						title={label}
						value={locale}
						options={selectableLocales.map((code) => ({ value: code, label: languageName(code), detail: code }))}
						onPick={(next) =>
							edit((draft) => {
								draft.metadata.page.locale = next;
							})
						}
						onDone={() => setOpen(false)}
					/>
				</View>
			</Sheet>
		</>
	);
}
