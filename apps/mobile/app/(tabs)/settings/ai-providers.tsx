import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { orpc } from "@/api/client";
import { ProviderList } from "@/features/ai/provider-list";
import { AiUsageSection } from "@/features/ai/usage";
import { Screen, Text } from "@/ui";

export default function ProvidersScreen() {
	const { t } = useLingui();
	const queryClient = useQueryClient();
	return (
		<Screen
			onRefresh={() =>
				Promise.allSettled([
					queryClient.invalidateQueries({ queryKey: orpc.aiProviders.key() }),
					queryClient.invalidateQueries({ queryKey: orpc.ai.usage.key() }),
				])
			}
		>
			<Stack.Screen options={{ title: t`AI providers` }} />
			<Text color="ink2">{t`Writing help, tailored suggestions and the assistant. The default provider is used wherever you don't pick one. Your keys stay encrypted.`}</Text>
			<ProviderList />
			<AiUsageSection />
		</Screen>
	);
}
