import { t } from "@lingui/core/macro";
import { useResumeStore } from "@/draft";

/**
 * Share and History are builder routes: `app/builder/[id]/_layout.tsx` owns the draft (open, close, conflict sheet).
 * They only subscribe, and see no document until the owner has loaded this resume.
 */
export function useShareDocument(id: string) {
	const draft = useResumeStore();
	return draft.document?.id === id ? draft : { ...draft, document: null, data: null };
}

/** flush resolves on offline/conflict failures too; check the resulting status before server actions. */
export async function flushResume(id: string) {
	if (useResumeStore.getState().document?.id !== id) throw new Error(t`Couldn't load the resume.`);
	await useResumeStore.getState().flush();
	const state = useResumeStore.getState();
	if (state.document?.id !== id || state.conflict || !["idle", "saved"].includes(state.status)) {
		throw new Error(t`Couldn't save your changes. Try again before continuing.`);
	}
	return state.document;
}
