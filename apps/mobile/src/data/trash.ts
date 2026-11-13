import type { TrashRef } from "./lifecycle";
import type { Backend } from "./resources";
import { t } from "@lingui/core/macro";
import { dataClient } from "./client";
import { activeDataScope, assertDataScope } from "./scope";
export const TRASH_RETENTION_DAYS = { resume: 30, letter: 30, application: 30 } as const;
/** Capture every page before confirming a destructive count. */
export async function allApplicationTrash(read = dataClient.applications.listTrash) {
	const result: Awaited<ReturnType<typeof read>>["items"] = [];
	for (let offset = 0; ;) {
		const page = await read({ limit: 100, offset });
		result.push(...page.items);
		offset += page.items.length;
		if (offset >= page.total) return result;
		if (page.items.length === 0) throw new Error(t`Trash changed while loading. Refresh before continuing.`);
	}
}
export async function loadTrashSnapshot(backend: Backend, signal?: AbortSignal) {
	const [documents, applications] = await Promise.all([
		backend.read("documents", { trashed: true }, signal),
		allApplicationTrash((input) => backend.read("applicationTrash", input, signal)),
	]);
	const refs: TrashRef[] = [
		...documents.map(({ id, type }) => ({ id, type })),
		...applications.map(({ id, trashedAt }) => ({ id, type: "application" as const, trashedAt })),
	];
	return {
		resumes: documents.filter((row) => row.type === "resume"),
		letters: documents.filter((row) => row.type === "letter"),
		applications,
		refs,
		count: refs.length,
		retentionDays: TRASH_RETENTION_DAYS,
	};
}

/** Act only on the captured selection; later arrivals never enter the confirmation's destructive set. */
export async function emptyTrashSnapshot(refs: readonly TrashRef[]) {
	const scope = activeDataScope();
	let deleted = 0;
	let skipped = 0;
	const failed: { refs: readonly TrashRef[]; error: unknown }[] = [];
	const documents = refs.filter((ref) => ref.type !== "application");
	for (let offset = 0; offset < documents.length; offset += 5000) {
		const batch = documents.slice(offset, offset + 5000);
		try {
			assertDataScope(scope);
			const result = await dataClient.documents.purgeMany({ documents: batch }, { context: { scope } });
			deleted += result.deleted;
			skipped += result.skipped;
		} catch (error) {
			failed.push({ refs: batch, error });
		}
	}
	for (const ref of refs) {
		if (ref.type !== "application") continue;
		try {
			if (!ref.trashedAt) throw new Error(t`Refresh Trash before continuing.`);
			assertDataScope(scope);
			await dataClient.applications.purge({ id: ref.id, trashedAt: ref.trashedAt }, { context: { scope } });
			deleted++;
		} catch (error) {
			failed.push({ refs: [ref], error });
		}
	}
	return { deleted, skipped, failed };
}
