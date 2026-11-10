import { now } from "./clock";
import { encode, decode } from "./codec";
import { assertStageGate } from "./write-policy";
import Storage from "@/data/storage";

export const queueKinds = ["documents", "letters", "profile", "stories-and-facts", "applications"] as const;
export type QueueKind = (typeof queueKinds)[number];
export type Failure = "offline" | "session-expired" | "conflict" | "no-response";
export type QueuedWrite = {
	id: string;
	kind: QueueKind;
	operation: string;
	input: unknown;
	createdAt: string;
	failure?: Failure | undefined;
};
export type QueueStorage = {
	getItemSync(key: string): string | null;
	setItemSync(key: string, value: string): void;
	removeItemSync(key: string): unknown;
};
export const writableOperations = [
	"applicationProfile.save",
	"career.saveProfile",
	"career.updateProfile",
	"career.saveFact",
	"career.updateFact",
	"career.saveStory",
	"career.saveWorkspace",
	"applications.update",
	"documents.rename",
	"documents.setTags",
	"documents.setLocked",
	"documents.linkApplication",
	"documents.copyForJob",
	"applications.bulkUpdate",
	"career.markNotificationRead",
	"career.dismissOpportunity",
	"career.forgetFact",
	"career.deleteStory",
	"career.updateOffer",
	"career.deleteSavedItem",
	"career.deleteSchedule",
	"feedback.revoke",
	"feedback.resolveComment",
	"resume.renameVersion",
	"resume.deleteVersion",
	"coverLetters.renameVersion",
	"coverLetters.deleteVersion",
] as const;
export type WriteOperation = (typeof writableOperations)[number];
const keyFor = (scope: string) => `queue:${scope}`;
export function failureOf(error: unknown): Failure {
	const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
	if (code === "UNAUTHORIZED" || code === "SESSION_EXPIRED") return "session-expired";
	if (/CONFLICT|CURRENT_CLIENT_REQUIRED/.test(code)) return "conflict";
	return code === "OFFLINE" ? "offline" : "no-response";
}
export function validateWrites(value: unknown): QueuedWrite[] {
	if (!Array.isArray(value)) throw new Error("Invalid queued changes.");
	const ids = new Set<string>();
	for (const entry of value) {
		if (
			!entry ||
			typeof entry !== "object" ||
			typeof entry.id !== "string" ||
			ids.has(entry.id) ||
			!queueKinds.includes(entry.kind) ||
			!writableOperations.includes(entry.operation) ||
			!Number.isFinite(Date.parse(entry.createdAt)) ||
			!("input" in entry)
		)
			throw new Error("Invalid queued change.");
		assertStageGate(entry.operation, entry.input);
		ids.add(entry.id);
	}
	return value;
}
export function createWriteQueue(storage: QueueStorage = Storage) {
	const listeners = new Set<() => void>();
	const flights = new Map<string, Promise<void>>();
	const locked = new Set<string>();
	const changed = () => {
		for (const listener of listeners) listener();
	};
	const list = (scope: string): QueuedWrite[] =>
		validateWrites(decode(JSON.parse(storage.getItemSync(keyFor(scope)) ?? "[]")));
	const save = (scope: string, rows: QueuedWrite[]) => {
		storage.setItemSync(keyFor(scope), JSON.stringify(encode(rows)));
		changed();
	};
	const validateRestore = (scope: string, entries: unknown) => {
		if (locked.has(scope)) throw new Error("Changes are saving. Try again.");
		const rows = validateWrites(entries);
		const existing = list(scope);
		if (rows.some((row) => existing.some((other) => other.id === row.id)))
			throw new Error("Existing changes must be reviewed before restoring.");
		return rows;
	};
	return {
		list,
		validateRestore,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		isSaving: (scope: string) => locked.has(scope),
		count(scope: string) {
			const counts = Object.fromEntries(queueKinds.map((kind) => [kind, 0])) as Record<QueueKind, number>;
			for (const row of list(scope)) counts[row.kind]++;
			return counts;
		},
		enqueue(scope: string, write: Omit<QueuedWrite, "createdAt" | "failure">) {
			const row = { ...write, createdAt: now().toISOString() };
			const rows = list(scope);
			if (rows.some((existing) => existing.id === row.id)) throw new Error("Change already queued.");
			validateWrites([row]);
			save(scope, [...rows, row]);
		},
		restore(scope: string, entries: unknown) {
			const rows = validateRestore(scope, entries);
			const existing = list(scope);
			save(scope, [...existing, ...rows]);
		},
		discard(scope: string) {
			if (locked.has(scope)) throw new Error("Changes are saving. Try again.");
			storage.removeItemSync(keyFor(scope));
			changed();
		},
		review(scope: string, id: string, input: unknown) {
			if (locked.has(scope)) throw new Error("Changes are saving. Try again.");
			save(
				scope,
				list(scope).map((row) => (row.id === id ? { ...row, input, failure: undefined } : row)),
			);
		},
		flush(scope: string, send: (write: QueuedWrite) => Promise<unknown>, current: () => boolean): Promise<void> {
			const flight = flights.get(scope);
			if (flight) return flight;
			locked.add(scope);
			changed();
			const result = (async () => {
				for (;;) {
					if (!current()) throw Object.assign(new Error("Sign in again."), { code: "SESSION_EXPIRED" });
					const row = list(scope)[0];
					if (!row) return;
					if (row.failure === "conflict")
						throw Object.assign(new Error("Review conflicting changes."), { code: "CONFLICT" });
					let accepted: unknown;
					try {
						accepted = await send(row);
					} catch (error) {
						save(
							scope,
							list(scope).map((entry) => (entry.id === row.id ? { ...entry, failure: failureOf(error) } : entry)),
						);
						throw error;
					}
					const remaining = list(scope).filter((entry) => entry.id !== row.id);
					// Own consecutive profile edits retain remote conflict checks while advancing our accepted revision.
					if (
						row.operation === "applicationProfile.save" &&
						accepted &&
						typeof accepted === "object" &&
						"revision" in accepted &&
						row.input &&
						typeof row.input === "object" &&
						"expectedRevision" in row.input
					) {
						const previousRevision = row.input.expectedRevision;
						for (const entry of remaining) {
							if (
								entry.operation !== row.operation ||
								!entry.input ||
								typeof entry.input !== "object" ||
								!("expectedRevision" in entry.input)
							)
								continue;
							if (entry.input.expectedRevision === previousRevision)
								entry.input = { ...entry.input, expectedRevision: accepted.revision };
						}
					}
					save(scope, remaining);
				}
			})().finally(() => {
				flights.delete(scope);
				locked.delete(scope);
				changed();
			});
			flights.set(scope, result);
			return result;
		},
	};
}
export const writeQueue = createWriteQueue();
