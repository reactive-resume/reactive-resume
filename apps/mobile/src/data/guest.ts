import type { Backend, ResourceInput, ResourceOutput, Resource } from "./resources";
import { t } from "@lingui/core/macro";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { now } from "./clock";
import { decode, encode } from "./codec";
import { getAccountScope } from "@/auth/session";
import Storage from "@/data/storage";

type Row = Record<string, unknown>;
type GuestDocuments = { resumes: Row[]; letters: Row[] };
const key = () => {
	const scope = getAccountScope();
	if (!scope) throw new Error("Guest session ended.");
	return `guest-documents:${scope}`;
};
const load = (): GuestDocuments =>
	decode(JSON.parse(Storage.getItemSync(key()) ?? '{"resumes":[],"letters":[]}')) as GuestDocuments;
const save = (state: GuestDocuments) => Storage.setItemSync(key(), JSON.stringify(encode(state)));
/** Guest documents stay on this device. Account-only features never fall through to unauthenticated HTTP. */
export async function invokeGuest(operation: string, input: unknown): Promise<unknown> {
	await Promise.resolve();
	const fields = (input ?? {}) as Row;
	const state = load();
	const kind = operation.startsWith("coverLetters.") || fields.type === "letter" ? "letters" : "resumes";
	const rows = state[kind];
	const row = rows.find((row) => row.id === fields.id);
	if (operation === "documents.list")
		return [
			...state.resumes.map((row): Row => ({ ...row, type: "resume" })),
			...state.letters.map((row): Row => ({ ...row, type: "letter" })),
		]
			.filter(
				(row) =>
					Boolean(row.trashedAt) === Boolean(fields.trashed) &&
					(!fields.type || fields.type === "all" || row.type === fields.type) &&
					(!fields.q || String(row.name).toLowerCase().includes(String(fields.q).toLowerCase())),
			)
			.map((row) => ({
				...row,
				tags: row.tags ?? [],
				hasPassword: false,
				editedAt: row.updatedAt,
				recipient: row.recipient ?? null,
				application: null,
				slug: row.slug ?? null,
				isPublic: false,
				trashedAt: row.trashedAt ?? null,
			}));
	if (operation === "resume.getById" || operation === "coverLetters.getById") {
		if (!row) throw new Error("Document not found.");
		return row;
	}
	if (operation === "resume.create" || operation === "resume.import" || operation === "coverLetters.create") {
		const id = generateId();
		const at = now();
		const name = typeof fields.name === "string" ? fields.name : t`Untitled`;
		if (operation.startsWith("resume.")) {
			const data = resumeDataSchema.parse(fields.data ?? structuredClone(defaultResumeData));
			rows.push({
				id,
				name,
				slug: id,
				tags: [],
				isLocked: false,
				isPublic: false,
				showDownloadButtons: false,
				data,
				createdAt: at,
				updatedAt: at,
			});
			save(state);
			return id;
		}
		const letter = coverLetterSchema.parse({
			id,
			name,
			recipient: "",
			content: "",
			style: copyCoverLetterStyle(defaultResumeData),
			layout: "structured",
			sourceResumeId: null,
			sourceApplicationId: null,
			senderLinked: false,
			designLinked: false,
			isLocked: false,
			revision: 1,
			createdAt: at,
			updatedAt: at,
		});
		rows.push(letter);
		save(state);
		return letter;
	}
	if (operation === "resume.update" || operation === "coverLetters.update") {
		if (!row || row.isLocked) throw new Error("Document is missing or locked.");
		const next: Row = { ...row, ...fields, updatedAt: now(), revision: Number(row.revision ?? 0) + 1 };
		if (operation.startsWith("resume.")) next.data = resumeDataSchema.parse(next.data);
		else coverLetterSchema.parse(next);
		rows[rows.indexOf(row)] = next;
		save(state);
		return operation.startsWith("resume.") ? { updatedAt: next.updatedAt } : next;
	}
	if (operation === "documents.emptyTrash") {
		state.resumes = state.resumes.filter((row) => !row.trashedAt);
		state.letters = state.letters.filter((row) => !row.trashedAt);
		save(state);
		return;
	}
	if (operation.startsWith("documents.") && row) {
		if (row.isLocked && operation !== "documents.setLocked") throw new Error("Unlock this document before editing.");
		const action = operation.split(".")[1];
		if (action === "trash") row.trashedAt = now();
		else if (action === "restore") row.trashedAt = null;
		else if (action === "purge" && row.trashedAt) rows.splice(rows.indexOf(row), 1);
		else if (action === "rename") row.name = fields.name;
		else if (action === "setTags") row.tags = fields.tags;
		else if (action === "setLocked") row.isLocked = fields.isLocked;
		else throw new Error("Sign in to use this feature.");
		save(state);
		return;
	}
	throw new Error("Sign in to use this feature.");
}
const guestReadPaths: Partial<Record<Resource, string>> = {
	documents: "documents.list",
	resume: "resume.getById",
	letter: "coverLetters.getById",
};
export const guestBackend: Backend = {
	kind: "guest",
	async read<K extends Resource>(resource: K, input: ResourceInput<K>): Promise<ResourceOutput<K>> {
		const operation = guestReadPaths[resource];
		if (!operation) throw new Error("Sign in to use this feature.");
		return (await invokeGuest(operation, input)) as ResourceOutput<K>;
	},
	write: (operation, input) => invokeGuest(operation, input),
};
