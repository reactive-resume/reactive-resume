jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: () => null, setItemSync: jest.fn(), removeItemSync: jest.fn() },
}));
import { createWriteQueue, type QueueStorage } from "./queue";
test("queued profile edits advance only the revision accepted from our own preceding save", async () => {
	const queue = createWriteQueue(memory());
	queue.enqueue("alex", {
		id: "one",
		kind: "profile",
		operation: "applicationProfile.save",
		input: { data: { givenName: "Alex" }, expectedRevision: "base" },
	});
	queue.enqueue("alex", {
		id: "two",
		kind: "profile",
		operation: "applicationProfile.save",
		input: { data: { givenName: "Alex Morgan" }, expectedRevision: "base" },
	});
	const revisions: unknown[] = [];
	await queue.flush(
		"alex",
		async (row) => {
			revisions.push((row.input as { expectedRevision: string }).expectedRevision);
			return { revision: row.id };
		},
		() => true,
	);
	expect(revisions).toEqual(["base", "one"]);
});
function memory(): QueueStorage {
	const data = new Map<string, string>();
	return {
		getItemSync: (key) => data.get(key) ?? null,
		setItemSync: (key, value) => {
			data.set(key, value);
		},
		removeItemSync: (key) => {
			data.delete(key);
		},
	};
}
test("replay stays ordered, stops at conflicts, preserves appended work and counts kinds", async () => {
	const queue = createWriteQueue(memory());
	queue.enqueue("alex", { id: "a", kind: "profile", operation: "applicationProfile.save", input: { name: "Alex" } });
	queue.enqueue("alex", { id: "b", kind: "applications", operation: "applications.update", input: { id: "lumen" } });
	const sent: string[] = [];
	await expect(
		queue.flush(
			"alex",
			async (row) => {
				sent.push(row.id);
				if (row.id === "a")
					queue.enqueue("alex", { id: "c", kind: "stories-and-facts", operation: "career.saveFact", input: {} });
				else throw { code: "CONFLICT" };
			},
			() => true,
		),
	).rejects.toEqual({ code: "CONFLICT" });
	expect(sent).toEqual(["a", "b"]);
	expect(queue.count("alex")).toEqual({
		documents: 0,
		letters: 0,
		profile: 0,
		"stories-and-facts": 1,
		applications: 1,
	});
	expect(queue.list("alex")[0]?.failure).toBe("conflict");
	const send = jest.fn();
	await expect(queue.flush("alex", send, () => true)).rejects.toMatchObject({ code: "CONFLICT" });
	expect(send).not.toHaveBeenCalled();
	queue.review("alex", "b", { id: "lumen", reviewed: true });
	await queue.flush(
		"alex",
		async (row) => {
			sent.push(row.id);
		},
		() => true,
	);
	expect(sent).toEqual(["a", "b", "b", "c"]);
	expect(queue.list("alex")).toEqual([]);
});
test("export/restore is account-scoped and rejects malformed or duplicate writes without overwriting", () => {
	const queue = createWriteQueue(memory());
	queue.enqueue("alex", {
		id: "a",
		kind: "letters",
		operation: "documents.rename",
		input: { id: "letter-1", name: "Kept" },
	});
	const exported = JSON.parse(JSON.stringify(queue.list("alex")));
	const restored = createWriteQueue(memory());
	restored.restore("alex", exported);
	expect(restored.list("alex")).toEqual(queue.list("alex"));
	expect(restored.list("other")).toEqual([]);
	expect(() => restored.restore("alex", exported)).toThrow("Existing changes");
	expect(() => restored.restore("alex", [{ ...exported[0], id: "bad", operation: "auth.deleteAccount" }])).toThrow(
		"Invalid queued change",
	);
	expect(restored.list("alex")).toEqual(exported);
});
test("saving locks review/discard and concurrent flush shares one flight", async () => {
	const queue = createWriteQueue(memory());
	queue.enqueue("alex", { id: "a", kind: "profile", operation: "applicationProfile.save", input: {} });
	let resolve!: () => void;
	const waiting = new Promise<void>((done) => {
		resolve = done;
	});
	const send = jest.fn(() => waiting);
	const first = queue.flush("alex", send, () => true);
	const second = queue.flush("alex", send, () => true);
	expect(first).toBe(second);
	expect(() => queue.discard("alex")).toThrow("saving");
	expect(() => queue.review("alex", "a", {})).toThrow("saving");
	resolve();
	await first;
	expect(send).toHaveBeenCalledTimes(1);
	expect(queue.isSaving("alex")).toBe(false);
});
