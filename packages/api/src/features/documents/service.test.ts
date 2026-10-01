import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const resumeServiceMock = vi.hoisted(() => ({
	getById: vi.fn(),
	create: vi.fn(),
	delete: vi.fn(),
	setLocked: vi.fn(),
}));
const applicationServiceMock = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("../resume/service", () => ({ resumeService: resumeServiceMock }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: { getById: vi.fn(), update: vi.fn() } }));
vi.mock("../applications/service", () => ({ applicationService: applicationServiceMock }));

const { documentsService } = await import("./service");

// `select().from().where()` resolving to `rows`.
const rows = (result: unknown[]) => ({ from: () => ({ where: () => Promise.resolve(result) }) });

const updates = () => {
	const set = vi.fn((_changes: Record<string, unknown>) => ({
		where: () => Promise.resolve(),
	}));
	dbMock.update.mockReturnValue({ set });
	return set;
};

beforeEach(() => {
	for (const mock of [
		...Object.values(dbMock),
		...Object.values(resumeServiceMock),
		...Object.values(applicationServiceMock),
	])
		mock.mockReset();
});

describe("Trash", () => {
	it("won't move a locked document, and keeps the resume's error code", async () => {
		dbMock.select.mockReturnValueOnce(rows([{ isLocked: true, trashedAt: null }]));

		await expect(documentsService.trash({ userId: "u1", type: "resume", id: "r1" })).rejects.toMatchObject({
			code: "RESUME_LOCKED",
			status: 403,
		});
		expect(dbMock.update).not.toHaveBeenCalled();
	});

	it("deletes for good only what is already in Trash", async () => {
		dbMock.select.mockReturnValueOnce(rows([{ isLocked: false, trashedAt: null }]));
		await expect(documentsService.purge({ userId: "u1", type: "resume", id: "r1" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});

		dbMock.select.mockReturnValueOnce(rows([{ isLocked: false, trashedAt: new Date() }]));
		await documentsService.purge({ userId: "u1", type: "resume", id: "r1" });
		expect(resumeServiceMock.delete).toHaveBeenCalledWith({ id: "r1", userId: "u1" });
	});
});

describe("copyForJob", () => {
	const source = {
		name: "Product Designer — Lumen",
		tags: ["design"],
		data: { metadata: { page: { locale: "en-US" } } },
	};

	it("links the copy to the job, and gives the job the copy when it has no resume", async () => {
		resumeServiceMock.getById.mockResolvedValueOnce(source);
		dbMock.select.mockReturnValueOnce(rows([{ id: "a1", company: "Orbital", resumeId: null }]));
		resumeServiceMock.create.mockResolvedValueOnce("copy");
		const set = updates();

		const id = await documentsService.copyForJob({ userId: "u1", resumeId: "r1", applicationId: "a1" });

		expect(id).toBe("copy");
		expect(resumeServiceMock.create).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Product Designer — Orbital", tags: ["design"] }),
		);
		expect(set).toHaveBeenCalledWith({ applicationId: "a1" });
		expect(applicationServiceMock.update).toHaveBeenCalledWith({ userId: "u1", id: "a1", resumeId: "copy" });
	});

	it.each(["saved", "applied"])(
		"prepares a copy at %s while preserving its base and submitted documents",
		async (status) => {
			resumeServiceMock.getById.mockResolvedValueOnce(source);
			dbMock.select.mockReturnValueOnce(rows([{ id: "a1", company: "Orbital", resumeId: "base", status }]));
			resumeServiceMock.create.mockResolvedValueOnce("copy");
			const set = updates();

			await documentsService.copyForJob({ userId: "u1", resumeId: "r1", applicationId: "a1", name: "Mine" });

			expect(resumeServiceMock.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Mine" }));
			expect(set).toHaveBeenCalledTimes(1);
			if (status === "saved")
				expect(applicationServiceMock.update).toHaveBeenCalledWith({ userId: "u1", id: "a1", resumeId: "copy" });
			else expect(applicationServiceMock.update).not.toHaveBeenCalled();
			expect(resumeServiceMock.create).toHaveBeenCalledWith(expect.objectContaining({ data: source.data }));
		},
	);
});

describe("linkApplication", () => {
	it.each([
		{ status: "saved", resumeId: null, sentResumeVersionId: null, selected: true },
		{ status: "saved", resumeId: "base", sentResumeVersionId: null, selected: true },
		{ status: "applied", resumeId: "submitted", sentResumeVersionId: "version", selected: false },
		{ status: "saved", resumeId: "submitted", sentResumeVersionId: "version", selected: false },
	])("links manual preparation while preserving submission history: %j", async ({ selected, ...application }) => {
		dbMock.select.mockReturnValueOnce(rows([{ isLocked: false, trashedAt: null }]));
		dbMock.select.mockReturnValueOnce(rows([{ id: "a1", company: "Orbital", ...application }]));
		const set = vi.fn(() => ({ where: () => ({ returning: async () => [{ id: "new" }] }) }));
		dbMock.update.mockReturnValue({ set });
		await documentsService.linkApplication({ userId: "u1", type: "resume", id: "new", applicationId: "a1" });
		expect(set).toHaveBeenCalledWith({ applicationId: "a1" });
		if (selected)
			expect(applicationServiceMock.update).toHaveBeenCalledWith({ userId: "u1", id: "a1", resumeId: "new" });
		else expect(applicationServiceMock.update).not.toHaveBeenCalled();
	});
});
