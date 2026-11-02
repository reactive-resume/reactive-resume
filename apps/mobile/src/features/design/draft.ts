import type { ResumeDraftStore } from "@/draft/types";
import type { Template } from "@reactive-resume/schema/templates";
import { t } from "@lingui/core/macro";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { templateName } from "./presets";
import { readOnlyDraft, writeTo } from "./write";
import { useResumeStore } from "@/draft";
import { showToast } from "@/ui";

export type { DesignWrite } from "./write";

/** The builder layout owns the draft; Design only subscribes. */
export function useDesignDraft(id: string) {
	const draft = useResumeStore();
	return draft.document?.id === id ? draft : { ...draft, document: null, data: null };
}

export const designWrite = writeTo((recipe, options) => useResumeStore.getState().update(recipe, options));

/** The template held down in Design, shown on whichever page is visible (the phone half or the tablet page). */
const usePreviewStore = create<{ template: Template | null }>(() => ({ template: null }));

export const usePreviewTemplate = () => usePreviewStore((state) => state.template);
export const setPreviewTemplate = (template: Template | null) => usePreviewStore.setState({ template });

/** Clears the preview when Design unmounts, so no page keeps showing it. */
export function useClearPreviewOnLeave() {
	useEffect(() => () => setPreviewTemplate(null), []);
}

/** Applies a template as its own undo step, with a toast offering Undo. */
export function applyTemplate(template: Template) {
	setPreviewTemplate(null);
	const { data, update } = useResumeStore.getState();
	if (!data || data.metadata.template === template) return;
	update(
		(value) => {
			value.metadata.template = template;
		},
		{ newStep: true },
	);
	const changed = useResumeStore.getState().data;
	// Undo takes back the template change only; after another edit it would take back that edit instead.
	showToast({
		message: t`Template changed to ${templateName(template)}`,
		action: {
			label: t`Undo`,
			onPress: () => {
				const current = useResumeStore.getState();
				if (current.data === changed) current.undo();
				else showToast({ message: t`You've made changes since. Use Undo to step back through them.` });
			},
		},
	});
}

type PageDraft = Pick<ResumeDraftStore, "data" | "update" | "locked" | "undo">;

/** What a page renders: the draft with the held template swapped in, read-only while it shows (no Fit, no Undo). */
export function usePreviewedDraft<T extends PageDraft>(draft: T): T {
	const template = usePreviewTemplate();
	const { data } = draft;
	const previewed = useMemo(
		() => (data && template ? { ...data, metadata: { ...data.metadata, template } } : data),
		[data, template],
	);
	return template ? { ...readOnlyDraft(draft), data: previewed, locked: true } : draft;
}
