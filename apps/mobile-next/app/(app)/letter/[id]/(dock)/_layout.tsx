// Letter modes: Write, Design, Export.
import { useLocalSearchParams } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { LetterDocument } from "@/features/builder/shared/document";
import { DockTabBar, type DockItemSpec } from "@/ui/Dock";
import { FadeThroughProvider } from "@/ui/motion";

const items: DockItemSpec[] = [
	{ key: "index", label: "Write", icon: "pencil-simple" },
	{ key: "design", label: "Design", icon: "palette" },
	{ key: "export", label: "Export", icon: "export" },
];

export default function Layout() {
	const { id } = useLocalSearchParams<{ id: string }>();
	return (
		<FadeThroughProvider>
			<LetterDocument id={id} />
			<Tabs
				screenOptions={{ headerShown: false, animation: "none" }}
				tabBar={(props) => <DockTabBar {...props} variant="letter" items={items} />}
			>
				{items.map((item) => (
					<Tabs.Screen key={item.key} name={item.key} />
				))}
			</Tabs>
		</FadeThroughProvider>
	);
}
