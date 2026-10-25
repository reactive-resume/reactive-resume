import { useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { javascriptNotices, licenceTexts, nativeNotices } from "@/features/licences/notices";
import { ListRow, Screen, Segmented, Text, useTheme } from "@/ui";

export default function LicencesScreen() {
	const { t } = useLingui();
	const { space } = useTheme();
	const [kind, setKind] = useState<"native" | "javascript">("native");
	const [expanded, setExpanded] = useState<string | null>(null);
	return (
		<Screen scroll={false}>
			<Stack.Screen options={{ title: t`Licenses` }} />
			<Text color="ink2">{t`Third-party software notices. Tap a dependency to read its license.`}</Text>
			<Segmented
				label={t`Dependency type`}
				value={kind}
				onChange={(value) => {
					setKind(value);
					setExpanded(null);
				}}
				options={[
					{ value: "native", label: t`Native & fonts` },
					{ value: "javascript", label: t`JavaScript` },
				]}
			/>
			<FlatList
				data={kind === "native" ? nativeNotices : javascriptNotices}
				keyExtractor={(item) => item.title}
				extraData={expanded}
				initialNumToRender={12}
				renderItem={({ item }) => (
					<View>
						<ListRow
							title={item.title}
							selected={expanded === item.title}
							accessibilityHint={expanded === item.title ? t`Hide license` : t`Read license`}
							onPress={() => setExpanded(expanded === item.title ? null : item.title)}
						/>
						{expanded === item.title && (
							<View style={{ padding: space.s4, gap: space.s3 }}>
								{item.textIds.map((id, paragraph) => (
									<Text key={`${id}:${paragraph}`} selectable variant="callout">
										{licenceTexts[id]}
									</Text>
								))}
							</View>
						)}
					</View>
				)}
			/>
		</Screen>
	);
}
