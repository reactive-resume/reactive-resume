import type { MutationInputs, ResourceOutput } from "./resources";
import { t } from "@lingui/core/macro";
import { usePlatformActions } from "./actions";
import { useLocalValue } from "./local-state";
import { useCareerLibrary } from "./platform";
import { useDataBackend, useCareerPreferences } from "./provider";

export function useStoryUsage(id: string) {
	const library = useCareerLibrary();
	return { ...library, data: library.data?.filter((item) => item.evidence.storyIds.includes(id)) };
}
export function useSavedItemSources(id: string) {
	const library = useCareerLibrary();
	const { backend } = useDataBackend();
	const item = library.data?.find((row) => row.id === id);
	return {
		item,
		sources:
			backend.kind === "fake" && item?.data.kind === "briefing"
				? [
						{ id: "lumen-posting", label: t`Posting`, url: "https://lumen.com/careers" },
						{ id: "lumen-company", label: t`Company brief`, url: null },
					]
				: [],
		serverChangeNeeded: "career.savedItems: expose retained briefing sources" as const,
	};
}
/** Creates have no retry identity: retain full terms locally, require an explicit online save. */
export function useOfferDraft(applicationId: string) {
	const local = useLocalValue<MutationInputs["career.createOffer"] | null>(`offer-draft:${applicationId}`, null);
	const actions = usePlatformActions();
	return {
		terms: local.value,
		setTerms: local.set,
		async save() {
			if (!local.value || local.value.applicationId !== applicationId) throw new Error(t`Review the offer first.`);
			const result = await actions.run("career.createOffer", local.value);
			if (result) local.set(null);
			return result;
		},
		serverChangeNeeded: "career.createOffer: accept an idempotency key" as const,
	};
}
export function factSourceLabel(fact: ResourceOutput<"facts">[number], fake = false) {
	if (fact.source.kind === "resume") return t`From your resume`;
	if (fake && fact.source.id === "coach-2-nov") return t`You told the coach · 2 Nov`;
	if (fake && fact.source.id === "assistant-today") return t`You answered the assistant · today`;
	return fact.source.kind === "user-message" ? t`You said` : t`You added this`;
}
export function useFactSourceLabel() {
	const { backend } = useDataBackend();
	return (fact: ResourceOutput<"facts">[number]) => factSourceLabel(fact, backend.kind === "fake");
}
export function useNoticePeriod() {
	const preferences = useCareerPreferences();
	return {
		...preferences,
		weeks: preferences.data?.noticeWeeks,
		label:
			preferences.data?.noticeWeeks === 4
				? t`1 month`
				: preferences.data?.noticeWeeks == null
					? undefined
					: t`${preferences.data.noticeWeeks} weeks`,
	};
}
export function useDebriefDraft(applicationId: string) {
	const local = useLocalValue<MutationInputs["career.generate"]["task"] | null>(`debrief-draft:${applicationId}`, null);
	const actions = usePlatformActions();
	return {
		draft: local.value,
		save: local.set,
		generate() {
			if (local.value?.task !== "debrief") throw new Error(t`Review what happened first.`);
			return actions.run("career.generate", { applicationId, task: local.value, locale: "en-GB" });
		},
	};
}
