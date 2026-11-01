import type { RouterInput } from "@/api/client";
import { pendingRequestId, settleRequestId } from "@reactive-resume/utils/string";
import { client } from "@/api/client";

type CopyForJobInput = Omit<RouterInput["documents"]["copyForJob"], "newId">;

/**
 * Copies a resume for a job. A new job is saved with its copy, both or neither, and a retry (a lost response, a
 * second press, the screen opened again) sends the same ID, so nothing is saved twice. A server refusing the retry
 * (the copy or its job was deleted since) says so, and nothing is saved again.
 *
 * A server from before this ignores the ID and the new job: the copy comes back under an ID of its own, unlinked, so
 * the job is then saved and linked afterwards, as those servers always did it.
 */
export async function copyForJob(input: CopyForJobInput, signal: AbortSignal) {
	const key = `copy-for-job:${JSON.stringify(input)}`;
	const newId = pendingRequestId(key);
	const id = await client.documents.copyForJob({ ...input, newId }, { signal });
	if (input.application && id !== newId) {
		const applicationId = await client.applications.create({ ...input.application, resumeId: id }, { signal });
		await client.documents.linkApplication({ type: "resume", id, applicationId }, { signal });
	}
	settleRequestId(key);
	return id;
}
