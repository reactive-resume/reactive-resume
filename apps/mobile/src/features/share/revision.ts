import { flushResume } from "./document";
import { client } from "@/api/client";
import { useResumeStore } from "@/draft";
import { resume as draftResume } from "@/draft/runtime";

/**
 * Locks or unlocks a resume. When it's the open draft, the change goes through the draft's own revision, so Undo,
 * confirmed assistant decisions and the next autosave build on it instead of meeting a version conflict.
 */
export async function setResumeLocked(id: string, isLocked: boolean) {
	if (useResumeStore.getState().document?.id !== id) {
		await client.resume.setLocked({ id, isLocked });
		return;
	}
	if (isLocked) {
		// Locking saves pending edits first, then locks the revision they made.
		await flushResume(id);
		await draftResume.writeMetadata(async (baseline) => ({
			...baseline,
			...(await client.resume.setLocked({ id, isLocked, expectedUpdatedAt: baseline.updatedAt })),
		}));
		return;
	}
	// Unlocking can't wait for edits that a lock from elsewhere stopped, and that lock's revision may be unseen here:
	// it goes unchecked, and the draft takes the answer only while the saved data is unchanged.
	await draftResume.writeMetadata(
		async (baseline) => ({ ...baseline, ...(await client.resume.setLocked({ id, isLocked })) }),
		{ conditional: false },
	);
}

/** Sets or removes the web page's password after the draft's pending edits, as the draft's own revision. */
export async function setResumePassword(id: string, password: string | null) {
	await flushResume(id);
	await draftResume.writeMetadata(async (baseline) => ({
		...baseline,
		...(password === null
			? await client.resume.removePassword({ id, expectedUpdatedAt: baseline.updatedAt })
			: await client.resume.setPassword({ id, password, expectedUpdatedAt: baseline.updatedAt })),
	}));
}
