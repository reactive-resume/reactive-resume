jest.mock("@reactive-resume/utils/string", () => ({
	escapeHtml: (text: string) => text,
	generateId: () => "00000000-0000-4000-8000-000000000001",
}));
jest.mock("@/api/client", () => ({ streamClient: {} }));
jest.mock("./client", () => ({ dataClient: { applications: { listTrash: jest.fn() } } }));
jest.mock("./provider", () => ({}));
jest.mock("./actions", () => ({}));
jest.mock("./applied", () => ({}));
jest.mock("./lifecycle", () => ({}));
jest.mock("./scope", () => ({ assertDataScope: jest.fn(), activeDataScope: () => "storyboard" }));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: () => null, setItemSync: jest.fn(), removeItemSync: jest.fn(), getAllKeysSync: () => [] },
}));
import { connectivityState } from "./connectivity";
import { fixtureArtifact } from "./fixture-artifacts";
import { fixtureProposals } from "./fixture-proposals";
import { seed, fakeBackend, invokeFake, recordFixtureMessages } from "./fixtures";
import { matching, updateRecentSearches } from "./search";
import { createFrameDecoder, consumeAgentStream, emptyStream, reduceStream } from "./stream";
import { allApplicationTrash, TRASH_RETENTION_DAYS } from "./trash";
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
	expect(TRASH_RETENTION_DAYS).toEqual({ resume: 30, letter: 30, application: null });
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
test("fake document list/detail stay in sync; copy retry creates only one job and copy", async () => {
	seed("storyboard");
	await fakeBackend.write("documents.rename", { id: "resume-product", type: "resume", name: "Renamed" }, "storyboard");
	expect((await fakeBackend.read("resume", { id: "resume-product" })).name).toBe("Renamed");
	const input = { resumeId: "resume-product", newId: "copy-one", application: { company: "Lumen", role: "Designer" } };
	const first = await invokeFake("documents.copyForJob", input);
	expect(await invokeFake("documents.copyForJob", input)).toBe(first);
	const copies = (await fakeBackend.read("documents", {})).filter((row) => row.id === "copy-one");
	expect(copies).toHaveLength(1);
	expect(copies[0]?.application?.company).toBe("Lumen");
	await expect(invokeFake("documents.copyForJob", { ...input, name: "Different" })).rejects.toThrow("changed");
});
test("version snapshots stay immutable and restore preserves history", async () => {
	seed("storyboard");
	const before = await fakeBackend.read("resume", { id: "resume-product" });
	const version = (await invokeFake("resume.createVersion", { resumeId: before.id, name: "Before" })) as { id: string };
	const data = structuredClone(before.data);
	data.basics.name = "Changed";
	await invokeFake("resume.update", { id: before.id, data });
	expect(
		(await fakeBackend.read("resumeVersion", { resumeId: before.id, versionId: version.id })).data.basics.name,
	).toBe("Alex Morgan");
	await invokeFake("resume.restoreVersion", { resumeId: before.id, versionId: version.id });
	expect((await fakeBackend.read("resume", { id: before.id })).data.basics.name).toBe("Alex Morgan");
	expect(await fakeBackend.read("versions", { resumeId: before.id })).toHaveLength(5);
});
test("Forget removes text; fixture workspace data passes shared schemas", async () => {
	seed("storyboard");
	await invokeFake("career.forgetFact", { id: "fact-0" });
	expect(await fakeBackend.read("forgottenFacts", {})).toEqual([{ count: 1, at: expect.any(Date) }]);
	expect((await fakeBackend.read("facts", {})).some((row) => row.id === "fact-0")).toBe(false);
	for (const task of [
		{ task: "fit" },
		{ task: "briefing" },
		{ task: "reply", message: "Employer message" },
		{ task: "practice", question: "Question", answer: "Long answer", origin: "simulated", mode: "typed" },
	])
		expect(fixtureArtifact(task).kind).toBe(task.task);
});
test("fake conversation streams board reply and refuses stale proposal wording receipts", async () => {
	seed("storyboard");
	const thread = (await invokeFake("agent.threads.start", { resumeId: "resume-product", scope: "document" })) as {
		id: string;
	};
	const resume = await fakeBackend.read("resume", { id: "resume-product" });
	const proposals = fixtureProposals(resume.data);
	recordFixtureMessages(
		thread.id,
		{ id: "user-1", role: "user", parts: [{ type: "text", text: "Tailor" }] },
		"Reply",
		proposals,
	);
	const proposal = proposals[0];
	if (!proposal) throw new Error("Missing proposal");
	const input = {
		threadId: thread.id,
		messageId: "reply-user-1",
		toolCallId: "edits-reply-user-1",
		edits: [{ id: proposal.id, status: "accepted", after: "Changed" }],
	};
	await expect(invokeFake("agent.messages.setEditStatus", input)).rejects.toThrow("changed");
	const result = await invokeFake("agent.messages.setEditStatus", {
		...input,
		edits: [{ ...input.edits[0], after: proposal.after }],
	});
	expect(result).toMatchObject({ editsAccepted: 1 });
});
