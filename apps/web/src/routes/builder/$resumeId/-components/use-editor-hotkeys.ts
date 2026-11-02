import type { EditorMode } from "@/features/resume/editor/store";
import { useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "@reactive-resume/ui/components/toast";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { isEditableElementFocused, useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { useEditorStore } from "@/features/resume/editor/store";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { switchModeInstantly } from "@/libs/motion";

/**
 * The editor's keyboard map: 1/2/3/4 switch modes (4 is Share) outside fields, ⌘Z and ⇧⌘Z undo and redo outside
 * fields (fields keep their own undo), ⌘P downloads the PDF, ⌘⇧E opens Download, ⌘J toggles the assistant, and Esc
 * clears the page selection. Downloads need a connection, so ⌘P and ⌘⇧E do nothing offline.
 */
export function useEditorHotkeys(setMode: (mode: EditorMode) => void) {
	const { t } = useLingui();
	const hasSelection = useEditorStore((state) => Boolean(state.selection));
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	const undo = useResumeStore((state) => state.undo);
	const redo = useResumeStore((state) => state.redo);
	const resume = useCurrentResume();
	const { onDownloadPDF } = useResumeExport(resume);
	const isOnline = () => useResumeStore.getState().saveStatus !== "offline";

	useHotkey("1", () => switchModeInstantly(() => setMode("write")), {
		enabled: characterShortcuts,
		meta: { name: t`Write` },
	});
	useHotkey("2", () => switchModeInstantly(() => setMode("design")), {
		enabled: characterShortcuts,
		meta: { name: t`Design` },
	});
	useHotkey("3", () => switchModeInstantly(() => setMode("check")), {
		enabled: characterShortcuts,
		meta: { name: t`Check` },
	});
	useHotkey("4", () => switchModeInstantly(() => setMode("share")), {
		enabled: characterShortcuts,
		meta: { name: t`Share` },
	});

	useHotkey(
		"Mod+Z",
		() => {
			if (!isEditableElementFocused()) undo();
		},
		{ meta: { name: t`Undo` } },
	);
	useHotkey(
		"Mod+Shift+Z",
		() => {
			if (!isEditableElementFocused()) redo();
		},
		{ meta: { name: t`Redo` } },
	);
	useHotkey(
		"Control+Y",
		() => {
			if (!isEditableElementFocused()) redo();
		},
		{ meta: { name: t`Redo` } },
	);

	useHotkey(
		"Mod+P",
		() => {
			if (isOnline()) void onDownloadPDF();
		},
		{ meta: { name: t`Download PDF` } },
	);
	useHotkey(
		"Mod+Shift+E",
		() => {
			if (isOnline()) useEditorStore.getState().setSheetTab("download");
		},
		{ meta: { name: t`Download & history` } },
	);
	useHotkey(
		"Mod+J",
		() => {
			const { assistantOpen, setAssistantOpen } = useEditorStore.getState();
			setAssistantOpen(!assistantOpen, true);
		},
		{ meta: { name: t`Assistant` } },
	);
	useHotkey(
		"Escape",
		() => {
			if (!useEditorStore.getState().selection) return;
			if (isEditableElementFocused() && document.activeElement instanceof HTMLElement) document.activeElement.blur();
			useEditorStore.setState({ selection: null });
		},
		// Command palette binds Escape too. Both handlers should run.
		{
			preventDefault: false,
			stopPropagation: false,
			conflictBehavior: "allow",
			meta: hasSelection ? { name: t`Clear selection` } : {},
		},
	);

	useHotkey(
		"Mod+S",
		() => {
			toast.add({ type: "info", description: t`Your changes are saved automatically.`, id: "auto-save" });
		},
		{ meta: { name: t`Save` } },
	);
}
