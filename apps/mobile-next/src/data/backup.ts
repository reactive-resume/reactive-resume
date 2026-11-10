import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { now } from "./clock";
import { decode, encode } from "./codec";
import { resume, letter } from "./draft/runtime";
import { writeQueue, validateWrites } from "./queue";
import { getRetainedAccountScope } from "@/auth/session";

export type QueueBundle = {
	format: "reactive-resume-queued-changes";
	version: 1;
	scope: string;
	exportedAt: string;
	writes: ReturnType<typeof writeQueue.list>;
	resumes: unknown[];
	letters: unknown[];
};
export async function exportQueued(): Promise<QueueBundle> {
	const scope = getRetainedAccountScope();
	if (!scope) throw new Error("Sign in again.");
	const [resumes, letters] = await Promise.all([resume.exportPending(), letter.exportPending()]);
	if (scope !== getRetainedAccountScope()) throw new Error("The account changed. Try again.");
	return {
		format: "reactive-resume-queued-changes",
		version: 1,
		scope,
		exportedAt: now().toISOString(),
		writes: writeQueue.list(scope),
		resumes,
		letters,
	};
}
export function isQueueBundle(value: unknown): value is QueueBundle {
	return !!value && typeof value === "object" && "format" in value && value.format === "reactive-resume-queued-changes";
}
export async function restoreQueued(input: unknown): Promise<void> {
	const value = decode(input);
	const scope = getRetainedAccountScope();
	if (
		!isQueueBundle(value) ||
		value.version !== 1 ||
		!scope ||
		value.scope !== scope ||
		!Array.isArray(value.resumes) ||
		!Array.isArray(value.letters)
	)
		throw new Error("This backup belongs to another account or app version.");
	validateWrites(value.writes);
	resume.validateImport(value.resumes, scope);
	letter.validateImport(value.letters, scope);
	writeQueue.validateRestore(scope, value.writes);
	// Imports append; existing local work is never silently replaced.
	await resume.restorePending(value.resumes);
	await letter.restorePending(value.letters);
	writeQueue.restore(scope, value.writes);
}
/** Share completion cannot prove Files saved the file. UI must not treat dismissal as permission to discard. */
export async function shareQueuedBundle(): Promise<void> {
	const file = new File(Paths.cache, "queued-changes.json");
	file.write(JSON.stringify(encode(await exportQueued())));
	await Sharing.shareAsync(file.uri, { mimeType: "application/json", UTI: "public.json" });
}
/** A confirmed folder selection plus a completed write is the S8 Files-save completion boundary. */
export async function saveQueuedBundle(): Promise<{ uri: string }> {
	const bundle = await exportQueued();
	const directory = await Directory.pickDirectoryAsync();
	const name = `queued-changes-${now().getTime()}.json`;
	const file = directory.createFile(name, "application/json");
	file.write(JSON.stringify(encode(bundle)));
	return { uri: file.uri };
}
