import type { SheetTab } from "@/features/resume/editor/store";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "@/features/resume/editor/store";
import { useClosingValue } from "@/hooks/use-closing-value";

type DownloadSheetFrameProps = {
	tabs: { value: SheetTab; label: ReactNode; content: ReactNode }[];
	/** The tab shown when the open tab isn't one of `tabs`. */
	fallback: SheetTab;
};

/** Download & history: one sheet, 440px from the right; a full-height bottom sheet on phones. */
export function DownloadSheetFrame({ tabs, fallback }: DownloadSheetFrameProps) {
	const tab = useEditorStore((state) => state.sheetTab);
	// Closing keeps the open tab on screen until the sheet has slid away.
	const [shownTab, onOpenChangeComplete] = useClosingValue(tab);
	const setTab = useEditorStore((state) => state.setSheetTab);
	const isPhone = useBreakpoint() === "mobile";

	return (
		<Sheet
			open={tab !== null}
			onOpenChange={(open) => !open && setTab(null)}
			onOpenChangeComplete={onOpenChangeComplete}
		>
			<SheetContent
				side={isPhone ? "bottom" : "right"}
				closeLabel={t`Close`}
				className={cn("gap-0", isPhone && "h-[calc(100svh-1.5rem)]")}
			>
				<SheetHeader className="px-5 pt-3.5 pb-2.5">
					<SheetTitle>
						<Trans>Download & history</Trans>
					</SheetTitle>
				</SheetHeader>

				<Tabs
					value={tabs.some((item) => item.value === shownTab) ? shownTab : fallback}
					onValueChange={(value) => {
						// The page shows a version only while History is open.
						if (value !== "history") useEditorStore.setState({ historyVersionId: null });
						setTab(value as SheetTab);
					}}
					className="min-h-0 flex-1 gap-0"
				>
					<TabsList variant="line" aria-label={t`Share sections`} className="w-full justify-start gap-5 px-5">
						{tabs.map((item) => (
							<TabsTrigger key={item.value} value={item.value}>
								{item.label}
							</TabsTrigger>
						))}
					</TabsList>
					{tabs.map((item) => (
						<TabsContent key={item.value} value={item.value} className="overflow-y-auto p-5">
							{item.content}
						</TabsContent>
					))}
				</Tabs>
			</SheetContent>
		</Sheet>
	);
}
