// Resume builder modes: Edit, Design, Check, Share.
import { Tabs } from "expo-router/js-tabs";
import { DockTabBar, type DockItemSpec } from "@/ui/Dock";
import { FadeThroughProvider } from "@/ui/motion";

const items: DockItemSpec[] = [
	{ key: "index", label: "Edit", icon: "pencil-simple" },
	{ key: "design", label: "Design", icon: "palette" },
	{ key: "check", label: "Check", icon: "seal-check" },
	{ key: "share", label: "Share", icon: "share-network" },
];

export default function Layout() {
	return (
		<FadeThroughProvider>
			<Tabs
				screenOptions={{ headerShown: false, animation: "none" }}
				tabBar={(props) => <DockTabBar {...props} variant="builder" items={items} />}
			>
				{items.map((item) => (
					<Tabs.Screen key={item.key} name={item.key} />
				))}
			</Tabs>
		</FadeThroughProvider>
	);
}
