import type { Locale } from "@reactive-resume/utils/locale";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { languageCopyRequest } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { handToAssistant } from "./handoff";
import { client } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { useResumeStore } from "@/draft";
import { useDocumentOperations } from "@/features/documents/queries";
import { localeMap } from "@/features/settings/locale-names";
import { flushResume } from "@/features/share/document";
import { selectableLocales } from "@/i18n";
import { routes } from "@/routes";
import { Button, SelectSheet, Sheet, Text, useTheme } from "@/ui";

type TranslateResumeProps = { resumeId: string; onClose: () => void };

export function TranslateResume({ resumeId, onClose }: TranslateResumeProps) {
	const { t, i18n } = useLingui();
	const { space } = useTheme();
	const router = useRouter();
	const operations = useDocumentOperations();
	const sourceLocale = useResumeStore((state) =>
		state.document?.id === resumeId ? state.data?.metadata.page.locale : undefined,
	);
	const [locale, setLocale] = useState<Locale>(sourceLocale === "de-DE" ? "en-US" : "de-DE");
	const active = useRef(false);
	const create = async () => {
		if (active.current || !sourceLocale || locale === sourceLocale) return;
		active.current = true;
		try {
			await operations.run(async () => {
				const scope = getAccountScope();
				if (!scope) return;
				const source = await flushResume(resumeId);
				if (source.data.metadata.page.locale === locale) return;
				const language = i18n._(localeMap[locale]);
				const copy = await client.resume.duplicate(
					{ id: resumeId, name: `${source.name} — ${language}`, pageLocale: locale },
					{ context: { scope } },
				);
				if (getAccountScope() !== scope) return;
				handToAssistant(scope, copy, languageCopyRequest(locale));
				onClose();
				router.replace(routes.assistant(copy));
			});
		} finally {
			active.current = false;
		}
	};
	return (
		<>
			<Sheet
				open
				title={t`Translate into…`}
				onClose={() => {
					if (!operations.busy) onClose();
				}}
			>
				<View style={{ padding: space.s4, gap: space.s3 }}>
					<Text color="ink2">{t`The original stays unchanged. Send the copy for translations to review. Hidden content stays untranslated.`}</Text>
					<SelectSheet
						label={t`Language`}
						value={locale}
						options={selectableLocales
							.filter((code) => code !== sourceLocale)
							.map((code) => ({ value: code, label: i18n._(localeMap[code]) }))}
						disabled={operations.busy}
						searchable
						onChange={setLocale}
					/>
					<Button
						label={t`Create language copy`}
						loading={operations.busy}
						disabled={!sourceLocale || locale === sourceLocale}
						onPress={() => void create()}
					/>
				</View>
			</Sheet>
		</>
	);
}
