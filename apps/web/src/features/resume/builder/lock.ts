import { saveResumeMetadata, useResumeStore } from "./draft";
import { orpc } from "@/libs/orpc/client";

/**
 * Locks or unlocks the open resume through the autosave owner, so the next autosave builds on the new revision.
 * Locking saves pending edits first and is checked against the saved revision. Unlocking can't wait for edits that a
 * lock from elsewhere stopped, and that lock's revision may be unseen here: it goes unchecked, its answer becomes the
 * base only while the saved data is unchanged, and then the waiting edits save.
 */
export async function setResumeLocked(id: string, isLocked: boolean) {
	if (isLocked)
		return saveResumeMetadata(id, (expectedUpdatedAt, options) =>
			orpc.resume.setLocked.call({ id, isLocked, expectedUpdatedAt }, options),
		);
	const unlocked = await saveResumeMetadata(
		id,
		(_expectedUpdatedAt, options) => orpc.resume.setLocked.call({ id, isLocked }, options),
		{ savePending: false },
	);
	const store = useResumeStore.getState();
	if (store.resume?.id === id && store.saveStatus !== "saved") store.retrySave();
	return unlocked;
}
