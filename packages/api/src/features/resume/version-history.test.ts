import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const dbMock = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));

const { saveSessionVersion } = await import("./version-history");

const MINUTE = 60 * 1000;

// `select().from().where().orderBy().limit()` resolving to `rows`.
const selectChain = (rows: unknown[]) => ({
	from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }),
});

const insertValues = () => {
	const values = vi.fn((_input: Record<string, unknown>) => ({
		returning: async () => [{ id: "v1", kind: _input.kind, name: _input.name }],
	}));
	dbMock.insert.mockReturnValue({ values });
	return values;
};

const updateSet = () => {
	const set = vi.fn((_input: Record<string, unknown>) => ({ where: () => Promise.resolve() }));
	dbMock.update.mockReturnValue({ set });
	return set;
};

const data = (): ResumeData => structuredClone(defaultResumeData);

beforeEach(() => {
	for (const mock of Object.values(dbMock)) mock.mockReset();
	dbMock.delete.mockReturnValue({ where: () => Promise.resolve() });
	// The retention query that picks the newest autosaves to keep.
	dbMock.select.mockReturnValue(selectChain([]));
});

describe("saveSessionVersion", () => {
	const save = (sessionId?: string) =>
		saveSessionVersion({
			resumeId: "r1",
			userId: "u1",
			data: data(),
			aiOperationIds: ["source-operation"],
			...(sessionId ? { sessionId } : {}),
		});

	it("refreshes the session's one version after two minutes instead of adding another", async () => {
		dbMock.select.mockReturnValueOnce(selectChain([{ id: "v1", createdAt: new Date(Date.now() - 3 * MINUTE) }]));
		const set = updateSet();

		await save("visit");

		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({ createdAt: expect.any(Date), aiOperationIds: ["source-operation"] }),
		);
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("starts a session's version on its first save", async () => {
		dbMock.select.mockReturnValueOnce(selectChain([]));
		const values = insertValues();

		await save("visit");

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "auto", sessionId: "visit", aiOperationIds: ["source-operation"] }),
		);
	});

	it("without a session, adds an autosave only when the newest version is two minutes old", async () => {
		const values = insertValues();

		dbMock.select.mockReturnValueOnce(selectChain([{ id: "v1", createdAt: new Date(Date.now() - MINUTE) }]));
		await save();
		expect(values).not.toHaveBeenCalled();

		dbMock.select.mockReturnValueOnce(selectChain([{ id: "v1", createdAt: new Date(Date.now() - 3 * MINUTE) }]));
		await save();
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ kind: "auto", sessionId: null }));
	});
});
