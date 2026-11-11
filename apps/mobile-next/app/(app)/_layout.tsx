// The signed-in app: one JS stack. Pushes by default; full-screen modals, sheets and hero pushes are named here
// (BUILD.md §6.3). Docked areas (tabs, builder, letter) and Settings bring their own layouts.
import { Redirect, useGlobalSearchParams, usePathname } from "expo-router";
import { Stack } from "expo-router/js-stack";
import { useSession } from "@/auth/session";
import { keepPendingLink } from "@/features/auth/pending-link";
import { useScreenOptions } from "@/ui/navigation";

export default function AppLayout() {
	const options = useScreenOptions();
	const session = useSession();
	const pathname = usePathname();
	const params = useGlobalSearchParams<Record<string, string>>();
	// Signed out: A1, keeping where the visit was going for after sign-in.
	if (session.status === "signed-out") {
		const query = new URLSearchParams(params).toString();
		keepPendingLink(query ? `${pathname}?${query}` : pathname);
		return <Redirect href="/welcome" />;
	}
	return (
		<Stack screenOptions={options.push}>
			<Stack.Screen name="(tabs)" />
			<Stack.Screen name="builder/[id]/(dock)" options={options.hero} />
			{/* B1 opens from D1's thumbnail */}
			<Stack.Screen name="letter/[id]/(dock)" />
			<Stack.Screen name="settings" options={options.modal} />
			{/* S1 and its pushes */}
			<Stack.Screen name="documents/[id]/actions" options={options.sheet} />
			{/* D2 */}
			<Stack.Screen name="new" options={options.sheet} />
			{/* D3 */}
			<Stack.Screen name="import" options={options.modal} />
			{/* D4 */}
			<Stack.Screen name="builder/[id]/section/[section]/[item]/actions" options={options.sheet} />
			{/* B21 */}
			<Stack.Screen name="builder/[id]/download" options={options.sheet} />
			{/* B14 */}
			<Stack.Screen name="builder/[id]/assistant/index" options={options.modal} />
			{/* B16 */}
			<Stack.Screen name="builder/[id]/preview" options={options.hero} />
			{/* B18 */}
			<Stack.Screen name="builder/[id]/menu" options={options.sheet} />
			{/* B19 */}
			<Stack.Screen name="applications/new" options={options.modal} />
			{/* J5 */}
			<Stack.Screen name="applications/[id]/index" options={options.hero} />
			{/* J6 */}
			<Stack.Screen name="applications/[id]/stage" options={options.sheet} />
			{/* J7 J9 */}
			<Stack.Screen name="applications/[id]/interview" options={options.sheet} />
			{/* J8 */}
			<Stack.Screen name="career/schedules/[id]" options={options.sheet} />
			{/* C7 */}
			<Stack.Screen name="ai/consent" options={options.sheet} />
			{/* S7 */}
			<Stack.Screen name="consent" options={options.modal} />
			{/* A4 */}
		</Stack>
	);
}
