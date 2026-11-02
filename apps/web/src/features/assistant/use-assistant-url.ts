import { useEffect } from "react";
import { openAssistantFrom } from "./open";
import { useEditorStore } from "@/features/resume/editor/store";

type AssistantSearch = { assistant?: string | undefined; ask?: string | undefined };

/**
 * `?assistant=` opens the assistant on that conversation and `?ask=` only fills its composer. While a saved
 * conversation is open its id stays in the URL, so a reload reopens it where it was (the reply carries on on the server).
 * "new", "prepare" and `?ask=` leave the URL once used.
 */
export function useAssistantInUrl(search: AssistantSearch, setSearch: (patch: AssistantSearch) => void) {
	const { assistant, ask } = search;
	const open = useEditorStore((state) => state.assistantOpen);
	const thread = useEditorStore((state) => state.assistantThread);

	useEffect(() => {
		const state = useEditorStore.getState();
		// The URL says what's already open (this hook wrote it): nothing to do.
		if (assistant && !ask && state.assistantOpen && state.assistantThread === assistant) return;
		if (!openAssistantFrom({ assistant, draft: ask })) return;
		const saved = assistant && assistant !== "new" && assistant !== "prepare" && !ask ? assistant : undefined;
		setSearch({ assistant: saved, ask: undefined });
	}, [assistant, ask, setSearch]);

	useEffect(() => {
		// Read now, not from this render: the effect above may have just opened a conversation from the URL.
		const state = useEditorStore.getState();
		const current =
			state.assistantOpen && state.assistantThread && state.assistantThread !== "new"
				? state.assistantThread
				: undefined;
		if (current === assistant) return;
		if (!current && (assistant === "new" || assistant === "prepare" || ask)) return;
		setSearch({ assistant: current });
		// Only the assistant's own changes write the URL; the URL's changes are read above.
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- reading `assistant` here must not re-run on URL changes.
	}, [open, thread]);
}
