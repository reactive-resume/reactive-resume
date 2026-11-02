import { useLingui } from "@lingui/react/macro";
import { useRouter, Stack } from "expo-router";
import { Card, ListRow, Screen, Text } from "@/ui";

export default function AiScreen() {
	const router = useRouter();
	const { t } = useLingui();
	return (
		<Screen>
			<Stack.Screen options={{ title: t`AI & developer` }} />
			<Text color="ink2">{t`Connect the tools you use for writing, job search and working with your resumes.`}</Text>
			<Card>
				<ListRow
					title={t`AI providers`}
					leading="sparkle"
					chevron
					onPress={() => router.push("/settings/ai-providers")}
				/>
				<ListRow title={t`Web access`} leading="globe" chevron onPress={() => router.push("/settings/ai-web-access")} />
				<ListRow
					title={t`MCP server`}
					leading="terminal-window"
					chevron
					onPress={() => router.push("/settings/ai-mcp")}
				/>
				<ListRow
					title={t`Connected applications`}
					leading="plugs-connected"
					chevron
					onPress={() => router.push("/settings/ai-connections")}
				/>
				<ListRow
					title={t`Report AI content`}
					leading="warning-circle"
					chevron
					onPress={() => router.push("/settings/ai-report")}
				/>
			</Card>
		</Screen>
	);
}
