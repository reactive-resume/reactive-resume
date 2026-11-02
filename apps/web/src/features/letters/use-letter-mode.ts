import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useAssistantInUrl } from "@/features/assistant/use-assistant-url";
import { useEditorStore } from "@/features/resume/editor/store";

export type LetterMode = "write" | "design";

const routeApi = getRouteApi("/builder/letter/$coverLetterId");

/** The mode lives in the URL (`?mode=design`), so refreshing keeps it. */
export function useLetterMode() {
	const { mode = "write" } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();
	const setMode = useCallback(
		(next: LetterMode) =>
			void navigate({
				to: ".",
				resetScroll: false,
				search: (current: ReturnType<typeof routeApi.useSearch>) => ({
					...current,
					mode: next === "write" ? undefined : next,
				}),
				replace: true,
			}),
		[navigate],
	);
	return [mode, setMode] as const;
}

/** `?version=` opens History on that version (the page shows it read-only), then leaves the URL. */
export function useOpenLetterVersionFromUrl() {
	const { version } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		if (!version) return;
		useEditorStore.getState().setSheetTab("history");
		useEditorStore.setState({ historyVersionId: version });
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, version: undefined }),
			replace: true,
		});
	}, [version, navigate]);
}

/** `?assistant=` opens the assistant on that conversation; `?ask=` only fills its composer. Both then leave the URL. */
export function useOpenLetterAssistantFromUrl() {
	const { assistant, ask } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	const setSearch = useCallback(
		(patch: { assistant?: string | undefined; ask?: string | undefined }) =>
			void navigate({
				to: ".",
				resetScroll: false,
				search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, ...patch }),
				replace: true,
			}),
		[navigate],
	);
	useAssistantInUrl({ assistant, ask }, setSearch);
}
