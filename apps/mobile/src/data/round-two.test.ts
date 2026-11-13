jest.mock("@reactive-resume/utils/string", () => ({
	escapeHtml: (text: string) => text,
	generateId: () => "00000000-0000-4000-8000-000000000001",
}));
jest.mock("@/api/client", () => ({ streamClient: {} }));
jest.mock("./client", () => ({
	dataClient: { applications: { listTrash: jest.fn(), purge: jest.fn() }, documents: { purgeMany: jest.fn() } },
}));
jest.mock("./provider", () => ({}));
jest.mock("./actions", () => ({}));
jest.mock("./applied", () => ({}));
jest.mock("./lifecycle", () => ({}));
jest.mock("./scope", () => ({ assertDataScope: jest.fn(), activeDataScope: () => "storyboard" }));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: () => null, setItemSync: jest.fn(), removeItemSync: jest.fn(), getAllKeysSync: () => [] },
}));
import { dataClient } from "./client";
import { connectivityState } from "./connectivity";
import { seed, fakeBackend } from "./fixtures";
import { moneyDifference } from "./offer-compare";
import { validateWrites } from "./queue";
import { matching, updateRecentSearches } from "./search";
import { createFrameDecoder, consumeAgentStream, emptyStream, reduceStream } from "./stream";
import { rankToday } from "./today";
import { allApplicationTrash, emptyTrashSnapshot, TRASH_RETENTION_DAYS } from "./trash";
import { validatePracticeAudio } from "./workspace";
import { assertStageGate } from "./write-policy";

test("search normalizes history and matches all query words", () => {
	expect(updateRecentSearches(["Lumen", "Northwind"], " lumen ")).toEqual(["lumen", "Northwind"]);
	expect(
		updateRecentSearches(
			Array.from({ length: 30 }, (_, i) => String(i)),
			"role",
		),
	).toHaveLength(20);
	expect(matching("senior lumen", ["Lumen Senior Designer", "Lumen"], (value) => value)).toEqual([
		"Lumen Senior Designer",
	]);
});
test("unknown connectivity is not online; lost reachability is offline", () => {
	expect(connectivityState({})).toBe("unknown");
	expect(connectivityState({ isConnected: true, isInternetReachable: false })).toBe("offline");
	expect(connectivityState({ isConnected: true, isInternetReachable: true })).toBe("online");
});
test("Applied gate covers bulk writes and backup replay; copies require identity", () => {
	for (const op of ["applications.update", "applications.bulkUpdate"])
		expect(() => assertStageGate(op, { status: "applied" })).toThrow("Confirm");
	expect(() => assertStageGate("documents.copyForJob", { resumeId: "r" })).toThrow("durable");
});
test("Trash loads every page and refuses inconsistent empty pages", async () => {
	const read = jest
		.fn()
		.mockResolvedValueOnce({ items: [{ id: "first" }], total: 2 })
		.mockResolvedValueOnce({ items: [{ id: "second" }], total: 2 });
	expect(await allApplicationTrash(read)).toEqual([{ id: "first" }, { id: "second" }]);
	expect(read.mock.calls[1]?.[0]).toEqual({ limit: 100, offset: 1 });
	await expect(allApplicationTrash(jest.fn().mockResolvedValue({ items: [], total: 1 }))).rejects.toThrow("Refresh");
	expect(TRASH_RETENTION_DAYS).toEqual({ resume: 30, letter: 30, application: 30 });
});
test("SSE spans iterator values and replay replaces previous partial output", async () => {
	const decode = createFrameDecoder();
	expect(decode('data: {"type":"text-del')).toEqual([]);
	const chunks = decode('ta","delta":"hello"}\n\ndata: [DONE]\n\n');
	expect(chunks).toEqual([{ type: "text-delta", delta: "hello" }]);
	const chunk = chunks[0];
	if (!chunk) throw new Error("Missing stream chunk");
	let view = reduceStream(emptyStream(), chunk);
	view = reduceStream(view, { type: "start", messageId: "reply" });
	expect(reduceStream(view, { type: "text-delta", delta: "again" }).text).toBe("again");
	const controller = new AbortController();
	const returned = jest.fn(async () => ({ done: true as const, value: undefined }));
	const iterator = {
		next: async () => {
			controller.abort();
			return { done: false as const, value: 'data: {"type":"finish"}\n\n' };
		},
		return: returned,
	};
	const publish = jest.fn();
	await expect(consumeAgentStream(iterator, controller.signal, publish)).rejects.toThrow();
	expect(publish).not.toHaveBeenCalled();
	expect(returned).toHaveBeenCalledTimes(1);
});
test("audio validation rejects oversized, empty and unsupported uploads", () => {
	expect(() => validatePracticeAudio(2 * 1024 * 1024, "audio/mp4")).not.toThrow();
	for (const size of [0, Number.NaN, 2 * 1024 * 1024 + 1])
		expect(() => validatePracticeAudio(size, "audio/mp4")).toThrow();
	expect(() => validatePracticeAudio(2, "text/plain")).toThrow("format");
});

test("restored queue cannot bypass Applied confirmation", () => {
	expect(() =>
		validateWrites([
			{
				id: "unsafe",
				kind: "applications",
				operation: "applications.bulkUpdate",
				input: { ids: ["a"], status: "applied" },
				createdAt: new Date().toISOString(),
			},
		]),
	).toThrow("Confirm");
});
test("Today ranking is deterministic and never duplicates its hero in Needs you", async () => {
	seed("storyboard");
	const applications = await fakeBackend.read("applications", {});
	const offers = await fakeBackend.read("offers", {});
	const at = new Date("2026-11-07T08:41:00Z");
	const a = rankToday(applications, offers, at, "Europe/Berlin");
	const b = rankToday([...applications].reverse(), offers, at, "Europe/Berlin");
	expect(a.hero?.application.id).toBe(b.hero?.application.id);
	expect(a.needsYou.some((row) => row.application.id === a.hero?.application.id)).toBe(false);
	expect(a.comingUp.every((row) => row.step.kind === "interview")).toBe(true);
	const data = offers[0]?.data;
	if (!data || data.kind !== "offer") throw new Error("Missing offer");
	expect(moneyDifference(data, { ...data, currency: "USD" }, "base")).toBeNull();
	expect(moneyDifference(data, { ...data, period: "month" }, "base")).toBeNull();
});

test("Empty Trash consumes server receipts and only captured application generations", async () => {
	const documents = jest.mocked(dataClient.documents.purgeMany);
	const applications = jest.mocked(dataClient.applications.purge);
	documents.mockResolvedValueOnce({ deleted: 1, skipped: 1 });
	applications.mockRejectedValueOnce(new Error("Trash generation changed"));
	const at = new Date("2026-11-01T08:41:00Z");
	const result = await emptyTrashSnapshot([
		{ type: "resume", id: "r" },
		{ type: "letter", id: "l" },
		{ type: "application", id: "a", trashedAt: at },
	]);
	expect(documents).toHaveBeenCalledWith(
		{
			documents: [
				{ type: "resume", id: "r" },
				{ type: "letter", id: "l" },
			],
		},
		{ context: { scope: "storyboard" } },
	);
	expect(applications).toHaveBeenCalledWith({ id: "a", trashedAt: at }, { context: { scope: "storyboard" } });
	expect(result).toMatchObject({ deleted: 1, skipped: 1, failed: [{ refs: [{ id: "a" }], error: expect.any(Error) }] });
});
