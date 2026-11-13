import type { EditorMode } from "@/features/resume/editor/store";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { cn } from "@reactive-resume/utils/style";
import { DocumentMenu } from "./document-menu";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { useOpenIssueCount } from "@/features/resume/editor/check/use-check";
import { DownloadButtons, EditorBarFrame } from "@/features/resume/editor/chrome/bar";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { preloadDocumentExport, useResumeExport } from "@/features/resume/export/use-resume-export";
import { ResumeDownloadMenu } from "@/features/resume/share/download-menu";

type EditorBarProps = {
	layout: "desktop" | "tablet" | "mobile";
	/** Tablet in landscape: the panel can be pinned beside the page. */
	pinnable: boolean;
};

/**
 * The 56px editor bar. Desktop: back, name and status line · Write/Design/Check/Share · Undo, Redo, History, Assistant
 * and Download PDF, the one accent. The mode switch stays centred through a `1fr auto 1fr` grid.
 */
export function EditorBar({ layout, pinnable }: EditorBarProps) {
	// Download needs a connection.
	const offline = useResumeStore((state) => state.saveStatus === "offline");
	const resume = useCurrentResume();
	const { onDownloadPDF, isExporting } = useResumeExport(resume);
	const [, setMode] = useEditorMode();

	return (
		<EditorBarFrame
			layout={layout}
			pinnable={pinnable}
			menu={<DocumentMenu />}
			modes={<ModeTabs compact={layout === "tablet"} offline={offline} />}
			history={<UndoRedo />}
			historyInPanel
		>
			<DownloadButtons
				busy={isExporting}
				onDownload={() => void onDownloadPDF()}
				onPreload={preloadDocumentExport}
				compact={layout === "mobile"}
				iconOnly={layout === "tablet"}
				disabled={offline}
				renderMore={(button) => <ResumeDownloadMenu trigger={button} onReview={() => void setMode("check")} />}
			/>
		</EditorBarFrame>
	);
}

/** The document's Undo and Redo, the same steps as ⌘Z and ⇧⌘Z outside a field. Phones have no keyboard for those. */
function UndoRedo() {
	const undo = useResumeStore((state) => state.undo);
	const redo = useResumeStore((state) => state.redo);
	const canUndo = useResumeStore((state) => state.undoStack.length > 0 && !state.resume?.isLocked);
	const canRedo = useResumeStore((state) => state.redoStack.length > 0 && !state.resume?.isLocked);

	return (
		<>
			<IconButton icon="arrow-u-up-left" label={t`Undo`} shortcut="⌘Z" disabled={!canUndo} onClick={undo} />
			<IconButton icon="arrow-u-up-right" label={t`Redo`} shortcut="⇧⌘Z" disabled={!canRedo} onClick={redo} />
		</>
	);
}

const MODE_ICONS = {
	write: "pencil-simple",
	design: "palette",
	check: "list-checks",
	share: "globe-hemisphere-west",
} as const;

type ModeTabsProps = {
	/** Tablets keep the mode names with tighter padding. */
	compact: boolean;
	/** Share needs a connection: its tab is dimmed while offline. */
	offline: boolean;
};

/** Write · Design · Check · Share, in words. What Check found and whether the resume is public are said beside it. */
function ModeTabs({ compact, offline }: ModeTabsProps) {
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	const issueCount = useOpenIssueCount();
	const labels: Record<EditorMode, string> = {
		write: t`Write`,
		design: t`Design`,
		check: t({
			comment: "The resume builder mode that reviews the resume for problems. Not the Screening application stage.",
			message: "Check",
		}),
		share: t`Share`,
	};

	return (
		<TabsList aria-label={t`Editor mode`} data-mode-switch="">
			{(Object.keys(MODE_ICONS) as EditorMode[]).map((mode, index) => (
				// Keys 1–4 switch modes (outside text fields): said on hover and to assistive tech.
				<TabsTrigger
					key={mode}
					value={mode}
					disabled={mode === "share" && offline}
					className={cn(
						"flex-none disabled:text-ink-2 disabled:opacity-100 data-disabled:text-ink-2 data-disabled:opacity-100",
						compact && "px-2.5",
					)}
					aria-keyshortcuts={characterShortcuts ? String(index + 1) : undefined}
					title={
						characterShortcuts
							? t({
									comment: "Mode tab tooltip: the mode, then the key that opens it",
									message: `${labels[mode]} · key ${index + 1}`,
								})
							: labels[mode]
					}
				>
					{labels[mode]}
					{mode === "check" && (
						<span className="sr-only">
							{issueCount === 0 ? (
								<Trans>No open issues</Trans>
							) : (
								<Plural value={issueCount} one="# open issue" other="# open issues" />
							)}
						</span>
					)}
				</TabsTrigger>
			))}
		</TabsList>
	);
}
