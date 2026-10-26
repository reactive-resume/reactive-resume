import { Trans } from "@lingui/react/macro";
import { DownloadSheetFrame } from "@/features/resume/editor/chrome/download-sheet";
import { useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { DownloadTab } from "@/features/resume/share/download-tab";
import { HistoryTab } from "@/features/resume/share/history-tab";

/** Download & history: the ▾ beside Download PDF opens Download and the clock opens History. Sharing is a mode. */
export function DownloadSheet() {
	const setTab = useEditorStore((state) => state.setSheetTab);
	const [, setMode] = useEditorMode();

	return (
		<DownloadSheetFrame
			fallback="download"
			tabs={[
				{
					value: "download",
					label: <Trans>Download</Trans>,
					content: (
						<DownloadTab
							onReview={() => {
								setTab(null);
								setMode("check");
							}}
						/>
					),
				},
				{ value: "history", label: <Trans>History</Trans>, content: <HistoryTab /> },
			]}
		/>
	);
}
