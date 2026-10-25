import { useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSession } from "@/auth/session";
import { useResumeStore } from "@/draft";
import { Outline } from "@/features/write/outline";
import { Banner, EmptyState, useTheme } from "@/ui";

export default function WriteScreen() {
	const { t } = useLingui();
	const { colors } = useTheme();
	const { id, imported, section } = useLocalSearchParams<{ id: string; imported?: string; section?: string }>();
	// The builder layout owns the draft (and its conflict sheet); Write only reads it.
	const draft = useResumeStore();
	const session = useSession();
	const current = draft.document?.id === id;

	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<Stack.Screen options={{ title: t`Write`, headerTransparent: false }} />
			{session.status === "signed-out" || session.status === "expired" ? (
				<Banner tone="warn" message={t`Sign in to edit this resume.`} />
			) : draft.status === "error" && !current ? (
				<Banner
					tone="danger"
					message={t`Couldn't load the resume.`}
					action={{ label: t`Retry`, onPress: () => void draft.open(id).catch(() => undefined) }}
				/>
			) : null}
			{current ? (
				<Outline key={`${id}:${section ?? ""}`} resumeId={id} imported={imported} initialSection={section} />
			) : (
				<EmptyState icon="hourglass" title={t`Loading…`} />
			)}
		</View>
	);
}
