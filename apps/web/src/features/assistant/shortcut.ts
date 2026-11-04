import { isApple } from "@reactive-resume/ui/components/kbd";
import { useEditorStore } from "@/features/resume/editor/store";

export function useAssistantShortcutEnabled() {
	const open = useEditorStore((state) => state.assistantOpen);
	// Ctrl+J belongs to browser Downloads while the assistant is closed.
	return isApple() || open;
}
