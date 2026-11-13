// Page (from B6): paper A4 · Letter · Free-form, margins, and the resume's language, which sets section titles, date
// words and text direction (the content isn't translated).
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { View } from "react-native";
import { getLanguageName, supportedLocales } from "@reactive-resume/utils/locale";
import { BuilderScreen, editResume, useResumeData, useSaveWord } from "../shared/document";
import { applyMargins, MARGINS, type MarginId, matchMargins, PAPER } from "./presets";
import { FieldLabel, designUndo } from "./TypographyScreen";
import { BottomSheet, Icon, ListRow, SheetScrollView, Segmented, haptic, Text } from "@/ui";

type Paper = keyof typeof PAPER;

const languageName = (locale: string) => {
	try {
		return getLanguageName(locale);
	} catch {
		return locale;
	}
};

export function PageScreen() {
	const data = useResumeData();
	const word = useSaveWord();
	const [picking, setPicking] = useState(false);
	if (!data) return <BuilderScreen title={t`Page`}>{null}</BuilderScreen>;
	const page = data.metadata.page;
	const margins = matchMargins(data.metadata);
	return (
		<BuilderScreen
			title={t`Page`}
			status={word}
			subtitle={null}
			overlay={
				picking ? (
					<BottomSheet title={t`Language`} height={600} onClose={() => setPicking(false)}>
						<SheetScrollView>
							{supportedLocales.map((locale, i) => (
								<ListRow
									key={locale}
									title={languageName(locale)}
									top={i === 0}
									last={i === supportedLocales.length - 1}
									accessibilityRole="radio"
									accessibilityState={{ selected: page.locale === locale }}
									trailing={page.locale === locale ? <Icon name="check" size={24} color="accentText" /> : undefined}
									onPress={() => {
										setPicking(false);
										if (locale === page.locale) return;
										haptic("selection");
										editResume((d) => {
											d.metadata.page.locale = locale;
										});
										designUndo(t`Language changed`);
									}}
								/>
							))}
						</SheetScrollView>
					</BottomSheet>
				) : null
			}
		>
			<FieldLabel first>{t`Paper`}</FieldLabel>
			<View style={{ paddingHorizontal: 24 }}>
				<Segmented<Paper>
					options={(Object.keys(PAPER) as Paper[]).map((key) => ({ key, label: PAPER[key]() }))}
					value={page.format}
					onChange={(format) => {
						editResume((d) => {
							d.metadata.page.format = format;
						});
						designUndo(t`Paper changed`);
					}}
					accessibilityLabel={t`Paper`}
				/>
			</View>
			<FieldLabel>{t`Margins`}</FieldLabel>
			<View style={{ paddingHorizontal: 24 }}>
				<Segmented<MarginId>
					options={(Object.keys(MARGINS) as MarginId[]).map((key) => ({ key, label: MARGINS[key].label() }))}
					value={margins ?? "normal"}
					onChange={(id) => {
						editResume((d) => applyMargins(d.metadata, id));
						designUndo(t`Margins changed`);
					}}
					accessibilityLabel={t`Margins`}
				/>
			</View>
			<FieldLabel>{t`Language`}</FieldLabel>
			<ListRow title={languageName(page.locale)} trailing="caret" top last onPress={() => setPicking(true)} />
			<Text variant="ui" color="ink3" style={{ paddingTop: 8, paddingHorizontal: 24 }}>
				{t`Sets section titles, date words and text direction. Your content isn't translated.`}
			</Text>
		</BuilderScreen>
	);
}
