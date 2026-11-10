import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useDocumentId, DocumentState } from "../share/document";
import { useResumeVersions } from "@/data";
import { now, timeZone } from "@/data/clock";
import { PushScreen, Button, ListRow, SectionHeading, Text, useTheme } from "@/ui";

export function VersionsScreen() {
	const { colors } = useTheme();
	const { i18n } = useLingui();
	const zone = timeZone();
	const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: zone });
	const id = useDocumentId();
	const router = useRouter();
	const query = useResumeVersions(id);
	return (
		<PushScreen
			title={t`Versions`}
			subtitle={t`Every editing session is kept.`}
			barEnd={<Button label={t`Name this version`} tone="accentGhost" size="sm" disabled />}
		>
			<View style={{ marginTop: 20 }}>
				<ListRow
					title={t`Now`}
					secondary={t`The resume as it is`}
					leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} />}
					last
					onPress={() => router.push(`/builder/${id}/preview`)}
				/>
			</View>
			<DocumentState loading={query.isPending} error={query.isError} retry={() => void query.refetch()} height={270} />
			{query.data?.length === 0 && (
				<Text style={{ margin: 24 }}>{t`Only one version so far. Every editing session adds one automatically.`}</Text>
			)}
			{query.data?.map((version, index) => (
				<View key={version.id}>
					{index === 0 || day(query.data?.[index - 1]?.createdAt ?? version.createdAt) !== day(version.createdAt) ? (
						<SectionHeading
							title={
								day(version.createdAt) === day(now())
									? t`Today`
									: version.createdAt.toLocaleDateString(i18n.locale, { day: "numeric", month: "long", timeZone: zone })
							}
						/>
					) : null}
					<ListRow
						title={version.name ?? (version.kind === "ai" ? t`AI edit` : t`Editing session`)}
						secondary={`${version.createdAt.toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone })}${version.kind === "ai" ? t` · from the assistant` : version.name ? t` · named` : ""}`}
						leading={<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line2 }} />}
						trailing="caret"
						last
						onPress={() => router.push(`/builder/${id}/versions/${version.id}`)}
					/>
				</View>
			))}
		</PushScreen>
	);
}
