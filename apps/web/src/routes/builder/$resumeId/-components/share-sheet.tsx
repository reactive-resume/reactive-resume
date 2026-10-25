import { Trans } from "@lingui/react/macro";
import { ShareSheetFrame } from "@/features/resume/editor/chrome/share-sheet";
import { useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { DownloadTab } from "@/features/resume/share/download-tab";
import { HistoryTab } from "@/features/resume/share/history-tab";
import { LinkTab } from "@/features/resume/share/link-tab";

/**
 * Share & export: Link, Download and History. Share opens Link, the ▾ beside Download PDF opens Download and the
 * clock opens History.
 */
export function ShareSheet() {
	const setTab = useEditorStore((state) => state.setShareTab);
	const [, setMode] = useEditorMode();

	return (
		<ShareSheetFrame
			fallback="link"
			tabs={[
				{ value: "link", label: <Trans>Link</Trans>, content: <LinkTab /> },
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
