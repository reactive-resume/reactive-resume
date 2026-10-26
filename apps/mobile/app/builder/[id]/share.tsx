import { useLingui } from "@lingui/react/macro";
import { Stack, useLocalSearchParams } from "expo-router";
import { SharePane } from "@/features/share/pane";

export default function ShareRoute() {
	const { t } = useLingui();
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<>
			<Stack.Screen options={{ title: t`Share`, headerTransparent: false }} />
			<SharePane id={id} />
		</>
	);
}
