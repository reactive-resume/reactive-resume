import { useLingui } from "@lingui/react/macro";
import { Stack } from "expo-router";
import { useSession } from "@/auth/session";
import { Card, Screen, Text } from "@/ui";

export default function McpScreen() {
	const { t } = useLingui();
	const { server } = useSession();
	return (
		<Screen>
			<Stack.Screen options={{ title: t`MCP server` }} />
			<Text color="ink2">{t`Sign in from your AI client, or use an API key.`}</Text>
			<Card>
				<Text selectable variant="mono">{`${server}/mcp`}</Text>
			</Card>
			<Text color="ink2">{t`New keys start read-only. Create keys in your browser account settings.`}</Text>
			<Text variant="title">{t`Setup guide`}</Text>
			<Text selectable variant="mono">
				https://docs.rxresu.me/guides/using-the-mcp-server
			</Text>
		</Screen>
	);
}
