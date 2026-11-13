const mockValues = new Map<string, string>();
jest.mock("@lingui/core", () => ({ i18n: { _: (message: { message: string }) => message.message } }));
let mockId = 0;
jest.mock("@/auth/session", () => ({ getAccountScope: () => '["https://example.org","local-guest"]' }));
jest.mock("@reactive-resume/utils/string", () => ({
	generateId: () => `local-${++mockId}`,
	escapeHtml: (text: string) => text,
}));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: {
		getItemSync: (key: string) => mockValues.get(key) ?? null,
		setItemSync: (key: string, value: string) => mockValues.set(key, value),
		removeItemSync: (key: string) => mockValues.delete(key),
	},
}));
import { invokeGuest } from "./guest";
test("guest document edits survive local reload and Trash round-trip without calling an API", async () => {
	const id = await invokeGuest("resume.create", { name: "Local resume" });
	const before = (await invokeGuest("resume.getById", { id })) as { data: { basics: { name: string } } };
	before.data.basics.name = "Alex";
	await invokeGuest("resume.update", { id, data: before.data });
	expect(((await invokeGuest("resume.getById", { id })) as typeof before).data.basics.name).toBe("Alex");
	await invokeGuest("documents.trash", { type: "resume", id });
	expect(await invokeGuest("documents.list", {})).toEqual([]);
	expect(await invokeGuest("documents.list", { trashed: true })).toHaveLength(1);
	await invokeGuest("documents.restore", { type: "resume", id });
	expect(await invokeGuest("documents.list", {})).toHaveLength(1);
	await expect(invokeGuest("career.generate", {})).rejects.toThrow("Sign in");
});
