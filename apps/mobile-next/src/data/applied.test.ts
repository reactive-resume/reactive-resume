jest.mock("@/api/client", () => ({ client: {} }));
jest.mock("@/data/client", () => ({ dataClient: {} }));
jest.mock("@/auth/session", () => ({ getAccountScope: () => "alex" }));
jest.mock("expo-sqlite/kv-store", () => ({ __esModule: true, default: { getItemSync: () => null } }));
import { changedSinceLinked, createAppliedGate } from "./applied";
test("changed since compares document identity and revision; unknown links are never preselected", () => {
	expect(changedSinceLinked({ id: "resume", revision: "2" }, { id: "resume", revision: "1" })).toBe(true);
	expect(changedSinceLinked({ id: "resume", revision: "2" }, { id: "resume", revision: "2" })).toBe(false);
	expect(changedSinceLinked({ id: "resume", revision: "2" }, null)).toBe(true);
});
test("Applied checks reviewed versions before invoking the server's immutable submission transition", async () => {
	const updatedAt = new Date("2026-11-07T08:41:00Z");
	const update = jest.fn(async () => ({ status: "applied" }));
	const api = {
		applications: { getById: async () => ({ id: "lumen", resumeId: "resume", coverLetterId: null }), update },
		resume: { getById: async () => ({ id: "resume", name: "Product designer", updatedAt }) },
		coverLetters: {},
	} as unknown as Parameters<typeof createAppliedGate>[0];
	const gate = createAppliedGate(api);
	await expect(
		gate.markApplied("lumen", { resumeVersion: { id: "resume", revision: "old" }, letterVersion: null }),
	).rejects.toThrow("resume changed");
	expect(update).not.toHaveBeenCalled();
	await gate.markApplied("lumen", {
		resumeVersion: { id: "resume", revision: updatedAt.toISOString() },
		letterVersion: null,
	});
	expect(update).toHaveBeenCalledWith(
		expect.objectContaining({ status: "applied", resumeId: "resume", coverLetterId: null }),
		{ context: { scope: "alex" } },
	);
});
