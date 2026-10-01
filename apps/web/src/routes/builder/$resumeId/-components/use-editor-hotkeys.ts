import type { EditorMode } from "@/features/resume/editor/store";
import { t } from "@lingui/core/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "@reactive-resume/ui/components/toast";
import { isEditableElementFocused, useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { useEditorStore } from "@/features/resume/editor/store";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { switchModeInstantly } from "@/libs/motion";

/**
 * The editor's keyboard map: 1/2/3 switch modes outside fields, ⌘Z and ⇧⌘Z undo and redo outside fields
 * (fields keep their own undo), ⌘P downloads the PDF, ⌘⇧S opens Share, ⌘⇧E opens Download, ⌘J toggles
 * the assistant, and Esc clears the page selection. Download and Share need a connection, so their keys do
 * nothing offline.
 */
export function useEditorHotkeys(setMode: (mode: EditorMode) => void) {
	const undo = useResumeStore((state) => state.undo);
	const redo = useResumeStore((state) => state.redo);
	const resume = useCurrentResume();
	const { onDownloadPDF } = useResumeExport(resume);
	const isOnline = () => useResumeStore.getState().saveStatus !== "offline";

	useHotkey("1", () => switchModeInstantly(() => setMode("write")));
	useHotkey("2", () => switchModeInstantly(() => setMode("design")));
	useHotkey("3", () => switchModeInstantly(() => setMode("check")));

	useHotkey("Mod+Z", () => {
		if (!isEditableElementFocused()) undo();
	});
	useHotkey("Mod+Shift+Z", () => {
		if (!isEditableElementFocused()) redo();
	});
	useHotkey("Control+Y", () => {
		if (!isEditableElementFocused()) redo();
	});

	useHotkey("Mod+P", () => {
		if (isOnline()) void onDownloadPDF();
	});
	useHotkey(
		"Mod+Shift+S",
		() => {
			if (isOnline()) useEditorStore.getState().setShareTab("link");
		},
		{ ignoreInputs: true },
	);
	useHotkey("Mod+Shift+E", () => {
		if (isOnline()) useEditorStore.getState().setShareTab("download");
	});
	useHotkey("Mod+J", () => {
		const { assistantOpen, setAssistantOpen } = useEditorStore.getState();
		setAssistantOpen(!assistantOpen, true);
	});
	useHotkey(
		"Escape",
		() => {
			if (!useEditorStore.getState().selection) return;
			if (isEditableElementFocused() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
			useEditorStore.getState().select(null);
		},
		// Command palette binds Escape too. Both handlers should run.
		{ preventDefault: false, stopPropagation: false, conflictBehavior: "allow" },
	);

	useHotkey("Mod+S", () => {
		toast.add({ type: "info", description: t`Your changes are saved automatically.`, id: "auto-save" });
	});
}
