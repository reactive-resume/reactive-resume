// Resume builder modes: Edit, Design, Check, Share. The document's draft is mounted once here for every mode.
import { useLocalSearchParams } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useCheckReport } from "@/features/builder/check/report";
import { BuilderDocument, useResumeData } from "@/features/builder/shared/document";
import { DockTabBar, type DockItemSpec } from "@/ui/Dock";
import { FadeThroughProvider } from "@/ui/motion";

export default function Layout() {
	const { id } = useLocalSearchParams<{ id: string }>();
	// Check carries the warn dot while the report has open findings (B1 and B6 draw it).
	const { report } = useCheckReport(useResumeData() ?? undefined);
	const items: DockItemSpec[] = [
		{ key: "index", label: "Edit", icon: "pencil-simple" },
		{ key: "design", label: "Design", icon: "palette" },
		{ key: "check", label: "Check", icon: "seal-check", warn: (report?.findings.length ?? 0) > 0 },
		{ key: "share", label: "Share", icon: "share-network" },
	];
	return (
		<FadeThroughProvider>
			<BuilderDocument id={id} />
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
