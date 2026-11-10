import type { RouterInput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { now, zonedParts } from "./clock";
import { activeDataScope, assertDataScope } from "./scope";
import { dataClient as client } from "@/data/client";
export type DocumentRef = RouterInput["documents"]["trash"];
export type TrashRef = DocumentRef | { type: "application"; id: string; trashedAt?: Date };
export const moveToTrash = (ref: TrashRef) =>
	ref.type === "application" ? client.applications.trash({ id: ref.id }) : client.documents.trash(ref);
export const restore = (ref: TrashRef) =>
	ref.type === "application"
		? client.applications.restore({ id: ref.id, trashedAt: requireTrashedAt(ref) })
		: client.documents.restore(ref);
export const deletePermanently = (ref: TrashRef) =>
	ref.type === "application"
		? client.applications.purge({ id: ref.id, trashedAt: requireTrashedAt(ref) })
		: client.documents.purge(ref);
export const emptyDocumentTrash = () => client.documents.emptyTrash({});
export async function emptyApplicationTrash() {
	const { allApplicationTrash } = await import("./trash");
	const rows = await allApplicationTrash();
	for (const row of rows) await client.applications.purge({ id: row.id, trashedAt: row.trashedAt });
}
export async function closeApplication(
	id: string,
	closedReason: NonNullable<RouterInput["applications"]["update"]["closedReason"]>,
	note?: string,
) {
	const application = await client.applications.update({
		id,
		status: "closed",
		closedReason,
		stageEnteredAt: zonedParts(now()).date,
	});
	if (!note?.trim()) return application;
	try {
		return await client.applications.addNote({ id, text: note.trim(), date: zonedParts(now()).date });
	} catch (cause) {
		throw Object.assign(new Error(t`Application closed, but the note wasn't saved. Try saving the note again.`), {
			cause,
			application,
		});
	}
}
export async function reopenApplication(
	id: string,
	status?: Exclude<NonNullable<RouterInput["applications"]["update"]["status"]>, "closed">,
) {
	const scope = activeDataScope();
	const application = await client.applications.getById({ id }, { context: { scope } });
	assertDataScope(scope);
	if (application.status !== "closed") throw new Error(t`Application changed. Review it again.`);
	const submitted =
		!!application.sentResumeVersionId ||
		!!application.sentCoverLetterVersionId ||
		application.activity.some((entry) => entry.type === "stage" && entry.stage === "applied");
	const target = status ?? (submitted ? "applied" : "saved");
	if (target === "applied" && !submitted) throw new Error(t`Confirm what you sent before marking as applied.`);
	return client.applications.update(
		{ id, status: target, closedReason: null, stageEnteredAt: zonedParts(now()).date },
		{ context: { scope } },
	);
}

function requireTrashedAt(ref: { trashedAt?: Date }): Date {
	if (!ref.trashedAt) throw new Error("Refresh Trash before continuing.");
	return ref.trashedAt;
}
