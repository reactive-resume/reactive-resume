// Signed-out screens: A1 to A3. The server choice is a sheet over A1.
import { Stack } from "expo-router/js-stack";
import { useScreenOptions } from "@/ui/navigation";

export default function AuthLayout() {
	const options = useScreenOptions();
	return (
		<Stack screenOptions={options.push}>
			<Stack.Screen name="server" options={options.sheet} />
		</Stack>
	);
}
