import type { TrashRef } from "./lifecycle";
import type { Backend } from "./resources";
import { t } from "@lingui/core/macro";
import { dataClient } from "./client";
export const TRASH_RETENTION_DAYS = { resume: 30, letter: 30, application: null } as const;
/** Application Trash has no timed expiry. Capture every page before confirming a destructive count. */
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
