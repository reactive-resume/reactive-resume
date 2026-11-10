jest.mock("immer", () =>
	jest.requireActual(require.resolve("immer").replace(/immer\.legacy-esm\.js$/, "cjs/index.js")),
);
jest.mock("@reactive-resume/utils/string", () => ({ generateId: () => "session" }));
import { createDraftStore, type DraftAdapter } from "./store";
type Document = { id: string; isLocked: boolean; value: string; revision: number };
function environment() {
	const values = new Map<string, string>();
	return {
		storage: {
			getItemSync: (key: string) => values.get(key) ?? null,
			setItemSync: (key: string, value: string) => {
				values.set(key, value);
			},
			removeItemSync: (key: string) => values.delete(key),
			getAllKeysSync: () => [...values.keys()],
		},
		scope: async () => "alex",
		online: () => false,
		focused: () => false,
	};
}
function adapter(document: Document): DraftAdapter<Document, string> {
	return {
		kind: "resume",
		delay: 500,
		read: async () => document,
		data: (row) => row.value,
		withData: (row, value) => ({ ...row, value }),
		version: (row) => row.revision,
		matches: (a, b) => a.value === b.value,
		merge: (_saved, _submitted, current) => current,
		parse: (value) => {
			const row = value as Document;
			if (typeof row?.id !== "string" || typeof row.value !== "string") throw new Error("Invalid document.");
			return row;
		},
		save: async (row) => row,
		copy: async () => {},
		isConflict: () => false,
	};
}
test("offline edits export and restore through the same validated draft engine; locks block edits", async () => {
	jest.useFakeTimers();
	const original = { id: "resume", isLocked: false, value: "saved", revision: 1 };
	const first = createDraftStore(adapter(original), environment());
	await first.store.getState().open("resume");
	first.store.getState().update(() => "kept");
	await first.store.getState().flush();
	const bundle = await first.exportPending();
	expect(bundle).toHaveLength(1);
	expect(bundle[0]?.document.value).toBe("kept");
	expect(() => first.validateImport([bundle[0], bundle[0]])).toThrow("Invalid queued draft");
	const restored = createDraftStore(adapter(original), environment());
	await restored.restorePending(JSON.parse(JSON.stringify(bundle)));
	expect((await restored.listPending())[0]?.value).toBe("kept");
	await expect(restored.restorePending(bundle)).rejects.toThrow("Existing changes");
	const locked = createDraftStore(adapter({ ...original, isLocked: true }), environment());
	await locked.store.getState().open("resume");
	locked.store.getState().update(() => "lost");
	expect(locked.store.getState().data).toBe("saved");
	first.suspend();
	restored.suspend();
	locked.suspend();
	jest.clearAllTimers();
	jest.useRealTimers();
});
