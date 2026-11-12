import type { RouterInput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { generateId } from "@reactive-resume/utils/string";
import { dataClient } from "./client";
import { fakeBackend, isFake } from "./fixtures";
import { writeQueue } from "./queue";
import { realBackend } from "./resources";
import { activeDataScope, assertDataScope } from "./scope";
import Storage from "./storage";
import { syncQueued } from "./sync";

type Input = Omit<RouterInput["documents"]["copyForJob"], "newId">;
/** Durable request identity survives lost responses, screen visits, and process restarts. */
export function prepareJobCopy(input: Input) {
	const scope = activeDataScope();
	const key =
		`job-copy:${scope}:` +
		JSON.stringify([
			input.resumeId,
			input.applicationId ?? null,
			input.application
				? [
						input.application.company,
						input.application.role,
						input.application.location,
						input.application.sourceUrl,
						input.application.jobDescription,
						input.application.postingSource,
					]
				: null,
			input.name ?? null,
		]);
	const newId = Storage.getItemSync(key) ?? generateId();
	Storage.setItemSync(key, newId);
	return { scope, key, input: { ...input, newId } };
}
export async function copyForJob(input: Input, signal: AbortSignal) {
	const pending = prepareJobCopy(input);
	signal.throwIfAborted();
	const id = await dataClient.documents.copyForJob(pending.input, { signal, context: { scope: pending.scope } });
	// An older server that ignores the ID cannot provide atomic/idempotent copy+job.
	assertDataScope(pending.scope);
	if (id !== pending.input.newId) throw new Error(t`Update your server before copying for a job.`);
	Storage.removeItemSync(pending.key);
	return id;
}
export async function queueJobCopy(input: Input) {
	const pending = prepareJobCopy(input);
	if (!writeQueue.list(pending.scope).some((row) => row.id === pending.input.newId))
		writeQueue.enqueue(pending.scope, {
			id: pending.input.newId,
			kind: "documents",
			operation: "documents.copyForJob",
			input: pending.input,
		});
	await syncQueued(pending.scope, isFake() ? fakeBackend : realBackend);
	return pending.input.newId;
}
