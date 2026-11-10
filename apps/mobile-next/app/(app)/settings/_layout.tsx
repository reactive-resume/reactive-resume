// Settings: a full-screen modal with its own stack (S1 to S6). S6 rises as a modal inside it.
import { Stack } from "expo-router/js-stack";
import { useScreenOptions } from "@/ui/navigation";

export default function SettingsLayout() {
	const options = useScreenOptions();
	return (
		<Stack screenOptions={options.push}>
			<Stack.Screen name="ai/providers/[id]" options={options.modal} />
		</Stack>
	);
}
