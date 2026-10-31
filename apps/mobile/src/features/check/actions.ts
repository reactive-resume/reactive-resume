import type { CheckIssue } from "./issues";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ImperativeRouter } from "expo-router";
import { t } from "@lingui/core/macro";
import { Platform } from "react-native";
import { computeCheck } from "./model";
import { useResumeStore } from "@/draft";
import { routes } from "@/routes";
import { dismissToast, haptics, showToast } from "@/ui";

/** Shared draft owner retains history; a toast must never undo a later, unrelated edit. */
export function editWithUndo(
	id: string,
	edit: (draft: ResumeData) => void,
	message: string,
	applied?: readonly Proposal[],
) {
	const store = useResumeStore.getState();
	if (store.document?.id !== id || !store.data || store.locked) return false;
	store.update(edit, { newStep: true, ...(applied ? { applied } : {}) });
	const changed = useResumeStore.getState().data;
	if (changed === store.data) return false;
	const toastId = showToast({
		message,
		action: {
			label: t`Undo`,
			onPress: () => {
				const current = useResumeStore.getState();
				if (current.document?.id === id && current.data === changed && !current.locked) current.undo();
				else showToast({ message: t`Use the builder's Undo to undo earlier changes.` });
			},
		},
	});
	const unsubscribe = useResumeStore.subscribe((current) => {
		if (current.document?.id === id && current.data === changed) return;
		dismissToast(toastId);
		unsubscribe();
	});
	setTimeout(unsubscribe, 6000);
	if (Platform.OS === "ios") haptics.success();
	return true;
}

export function fixIssue(id: string, issue: CheckIssue, router: ImperativeRouter) {
	const current = useResumeStore.getState();
	if (current.document?.id !== id || !current.data || current.locked) return;
	// Resolve the stable key again: array pointers can move after a reorder or remote edit.
	const fresh = computeCheck(current.data).issues.find((entry) => entry.key === issue.key);
	if (!fresh) return;
	if (fresh.fix.kind === "apply") {
		editWithUndo(id, fresh.fix.apply, fresh.fix.done);
		return;
	}
	const target = fresh.fix.target;
	const tokens = fresh.finding.pointer.split("/");
	const items = tokens.indexOf("items");
	const field = tokens.slice(items === -1 ? 2 : items + 2).join("/");
	router.push({
		pathname:
			target.kind === "header"
				? routes.entry(id, "basics", "basics")
				: target.kind === "item"
					? routes.entry(id, target.sectionId, target.itemId)
					: target.sectionId === "summary"
						? routes.entry(id, "summary", "summary")
						: routes.builder(id, "write"),
		params: { section: target.kind === "header" ? "basics" : target.sectionId, field },
	});
}
