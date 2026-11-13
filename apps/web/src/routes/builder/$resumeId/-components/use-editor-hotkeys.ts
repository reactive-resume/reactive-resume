import type { EditorMode } from "@/features/resume/editor/store";
import { useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "@reactive-resume/ui/components/toast";
import { useAssistantShortcutEnabled } from "@/features/assistant/shortcut";
import { DOCUMENT_GROUP } from "@/features/keyboard-shortcuts/groups";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { useShortcutsPage } from "@/features/keyboard-shortcuts/store";
import { isEditableElementFocused, useCurrentResume, useResumeStore } from "@/features/resume/builder/draft";
import { useEditorStore } from "@/features/resume/editor/store";
import { stepUp } from "@/features/resume/editor/write/view";
import { useResumeExport } from "@/features/resume/export/use-resume-export";
import { switchModeInstantly } from "@/libs/motion";

/**
 * The editor's keyboard map: 1/2/3/4 switch modes (4 is Share) outside fields, ⌘Z and ⇧⌘Z undo and redo outside
 * fields (fields keep their own undo), ⌘P downloads the PDF, ⌘⇧E opens Download, ⌘J toggles the assistant, and Esc
 * steps up in Write (entry, section, outline), leaving a field first. Downloads need a connection, so ⌘P and ⌘⇧E do nothing offline.
 */
export function useEditorHotkeys(setMode: (mode: EditorMode) => void) {
	const { t } = useLingui();
	const assistantShortcutEnabled = useAssistantShortcutEnabled();
	const hasSelection = useEditorStore((state) => Boolean(state.selection));
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	const undo = useResumeStore((state) => state.undo);
	const redo = useResumeStore((state) => state.redo);
	const resume = useCurrentResume();
	const { onDownloadPDF } = useResumeExport(resume);
	const isOnline = () => useResumeStore.getState().saveStatus !== "offline";
	useShortcutsPage(null, t`The resume editor.`);

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
		{ meta: { name: t`Undo`, group: DOCUMENT_GROUP } },
	);
	useHotkey(
		"Mod+Shift+Z",
		() => {
			if (!isEditableElementFocused()) redo();
		},
		{ meta: { name: t`Redo`, group: DOCUMENT_GROUP } },
	);
	useHotkey(
		"Control+Y",
		() => {
			if (!isEditableElementFocused()) redo();
		},
		{ meta: { name: t`Redo`, group: DOCUMENT_GROUP } },
	);
	useHotkey(
		"Mod+S",
		() => {
			toast.add({ type: "info", description: t`Your changes are saved automatically.`, id: "auto-save" });
		},
		{ meta: { name: t`Save`, group: DOCUMENT_GROUP } },
	);

	useHotkey(
		"Mod+P",
		() => {
			if (isOnline()) void onDownloadPDF();
		},
		{ meta: { name: t`Download PDF`, group: DOCUMENT_GROUP } },
	);
	useHotkey(
		"Mod+Shift+E",
		() => {
			if (isOnline()) useEditorStore.getState().setSheetTab("download");
		},
		{ meta: { name: t`Download and history`, group: DOCUMENT_GROUP } },
	);
	useHotkey(
		"Mod+J",
		() => {
			const { assistantOpen, setAssistantOpen } = useEditorStore.getState();
			setAssistantOpen(!assistantOpen, true);
		},
		{ enabled: assistantShortcutEnabled, meta: { name: t`Assistant` } },
	);
	useHotkey(
		"Escape",
		() => {
			if (!useEditorStore.getState().selection) return;
			// A menu, dialog or list has the key first: closing it is all this press does.
			if (document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]')) return;
			// In a field, the first press leaves the field; the next one steps up.
			if (isEditableElementFocused() && document.activeElement instanceof HTMLElement) {
				document.activeElement.blur();
				return;
			}
			stepUp();
		},
		// Command palette binds Escape too. Both handlers should run.
		{
			preventDefault: false,
			stopPropagation: false,
			conflictBehavior: "allow",
			meta: hasSelection ? { name: t`Back to the list` } : {},
		},
	);
}
