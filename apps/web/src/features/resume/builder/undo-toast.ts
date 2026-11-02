import { t } from "@lingui/core/macro";
import { toast } from "@reactive-resume/ui/components/toast";
import { useResumeStore } from "./draft";
import { confirmUndone } from "@/libs/undone";

type UndoToastOptions = Omit<NonNullable<Parameters<typeof toast.add>[0]>, "description" | "actionProps"> & {
	/**
	 * Puts the change back another way once later edits sit on top of it, such as re-adding a deleted entry. Returns
	 * whether it could; when it can't, the toast says to use Undo instead.
	 */
	restore?: () => boolean;
};

/**
 * Confirms the change just made in a toast whose Undo takes back that change only. While it's still the latest step,
 * Undo there is the builder's Undo; after another edit that would take back the newer edit instead, so it restores the
 * change another way when it can, or says to use Undo in the editor.
 */
export function undoToast(description: string, { restore, ...options }: UndoToastOptions = {}) {
	const { resume, undoStack } = useResumeStore.getState();
	const changed = resume?.data;
	// The history step this change made: a revision from elsewhere can clear history and leave the data as it is.
	const step = undoStack.at(-1);
	const resumeId = resume?.id;
	return toast.add({
		...options,
		description,
		actionProps: {
			children: t`Undo`,
			onClick: () => {
				const current = useResumeStore.getState();
				// The toast can outlive the resume it was about: another one open here is left alone.
				if (!current.resume || current.resume.id !== resumeId) return;
				// Locked since: nothing can change until it's unlocked, so say that rather than "use Undo".
				if (current.resume.isLocked)
					return toast.add({ description: t`This resume is locked. Unlock it to make changes.` });
				// A locked resume's Undo changes nothing, so it isn't confirmed.
				if (
					changed &&
					current.resume.data === changed &&
					step &&
					current.undoStack.at(-1) === step &&
					!current.resume.isLocked
				) {
					current.undo();
					if (useResumeStore.getState().resume?.data !== changed) return confirmUndone();
				}
				if (restore && !current.resume.isLocked && restore()) return confirmUndone();
				toast.add({ description: t`You've made changes since. Use Undo to step back through them.` });
			},
		},
	});
}
