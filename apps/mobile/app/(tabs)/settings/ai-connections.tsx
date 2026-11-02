import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { orpc } from "@/api/client";
import { ConnectedApps } from "@/features/settings/connected-apps";
import { Screen, Text } from "@/ui";

export default function ConnectionsScreen() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	return (
		<Screen onRefresh={() => queryClient.invalidateQueries({ queryKey: orpc.auth.connections.list.key() })}>
			<Stack.Screen options={{ title: t`Connected applications` }} />
			<Text color="ink2">{t`Apps you allowed to use your account, such as AI clients. You can disconnect one anytime.`}</Text>
			<ConnectedApps />
		</Screen>
	);
}
