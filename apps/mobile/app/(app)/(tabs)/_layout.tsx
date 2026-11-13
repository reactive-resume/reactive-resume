// Root tabs: Today, Documents, Applications, Career in the shared dock (fade-through, no haptic).
import { Tabs } from "expo-router/js-tabs";
import { DockTabBar, type DockItemSpec } from "@/ui/Dock";
import { FadeThroughProvider } from "@/ui/motion";

const items: DockItemSpec[] = [
	{ key: "index", label: "Today", icon: "house-simple" },
	{ key: "documents/index", label: "Documents", shortLabel: "Docs", icon: "files" },
	{ key: "applications/index", label: "Applications", shortLabel: "Jobs", icon: "briefcase" },
	{ key: "career/index", label: "Career", icon: "compass" },
];

export default function Layout() {
	return (
		<FadeThroughProvider>
			<Tabs
				screenOptions={{ headerShown: false, animation: "none" }}
				tabBar={(props) => <DockTabBar {...props} variant="tabs" items={items} />}
			>
				{items.map((item) => (
					<Tabs.Screen key={item.key} name={item.key} />
				))}
			</Tabs>
		</FadeThroughProvider>
	);
}
