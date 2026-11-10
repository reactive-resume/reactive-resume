// Stand-in for a route whose screen is not built yet: enough chrome to navigate through it.
import { PushScreen, SheetScreen, TabScreen } from "@/ui";

export function RoutePlaceholder({ ids, kind, docked = false }: { ids: string; kind: string; docked?: boolean }) {
	if (kind === "sheet")
		return (
			<SheetScreen title={ids} height={470}>
				{null}
			</SheetScreen>
		);
	if (kind === "tab" && !docked) return <TabScreen title={ids}>{null}</TabScreen>;
	return (
		<PushScreen title={ids} back={kind === "modal" ? "close" : "back"} docked={kind === "tab"}>
			{null}
		</PushScreen>
	);
}
