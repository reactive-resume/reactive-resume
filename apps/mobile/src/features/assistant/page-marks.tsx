import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { routes } from "@/routes";
import { Button, Icon, Text, useTheme } from "@/ui";

export { useMarkedResumeData } from "./proposals";

type ProposedEditsCaptionProps = { resumeId: string; pending: number };

/**
 * Page tab: "2 proposed edits on this page · nothing changes until you accept", with Review back to the Assistant.
 * Render it over the page when `useMarkedResumeData(...).pending > 0`.
 */
export function ProposedEditsCaption({ resumeId, pending }: ProposedEditsCaptionProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	if (pending === 0) return null;
	return (
		<View
			accessibilityLiveRegion="polite"
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.s2,
				paddingStart: space.s3,
				paddingEnd: space.s1,
				paddingVertical: space.s1,
				borderRadius: radius.rLg,
				backgroundColor: colors.accentSoft,
			}}
		>
			<Icon name="sparkle" size={16} color={colors.accentText} />
			<Text variant="callout" color="accentText" style={{ flex: 1 }}>
				{plural(pending, {
					one: "# proposed edit on this page · nothing changes until you accept",
					other: "# proposed edits on this page · nothing changes until you accept",
				})}
			</Text>
			<Button variant="link" label={t`Review`} onPress={() => router.push(routes.assistant(resumeId))} />
		</View>
	);
}
