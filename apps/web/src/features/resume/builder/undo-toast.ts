import { t } from "@lingui/core/macro";
import { toast } from "@reactive-resume/ui/components/toast";
import { useResumeStore } from "./draft";

type UndoToastOptions = Omit<NonNullable<Parameters<typeof toast.add>[0]>, "description" | "actionProps"> & {
	/** Puts the change back another way once later edits sit on top of it, such as re-adding a deleted entry. */
	restore?: () => void;
};

/**
 * Confirms the change just made in a toast whose Undo takes back that change only. While it's still the latest step,
 * Undo there is the builder's Undo; after another edit that would take back the newer edit instead, so it restores the
 * change another way when it can, or says to use Undo in the editor.
 */
export function undoToast(description: string, { restore, ...options }: UndoToastOptions = {}) {
	const changed = useResumeStore.getState().resume?.data;
	return toast.add({
		...options,
		description,
		actionProps: {
			children: t`Undo`,
			onClick: () => {
				const current = useResumeStore.getState();
				if (changed && current.resume?.data === changed) return current.undo();
				if (restore && current.resume && !current.resume.isLocked) return restore();
				toast.add({ description: t`You've made changes since. Use Undo to step back through them.` });
			},
		},
	});
}
