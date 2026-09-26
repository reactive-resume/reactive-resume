import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer; the logic under test is the activity-timeline bookkeeping, not SQL.
const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	execute: vi.fn(),
	transaction: vi.fn(),
}));
const resumeGetByIdMock = vi.hoisted(() => vi.fn());
const storageDeleteMock = vi.hoisted(() => vi.fn());
const uploadFileMock = vi.hoisted(() => vi.fn());

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	application: {
		id: "id",
		userId: "user_id",
		status: "status",
		activity: "activity",
		appliedAt: "applied_at",
		updatedAt: "updated_at",
		resumeFileUrl: "resume_file_url",
		coverLetterUrl: "cover_letter_url",
	},
}));
vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => a,
	arrayContains: (...a: unknown[]) => a,
	desc: (x: unknown) => x,
	eq: (...a: unknown[]) => a,
	inArray: (...a: unknown[]) => a,
	sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), {
		join: (values: unknown[]) => values,
	}),
}));
vi.mock("../resume/service", () => ({
	resumeService: { getById: resumeGetByIdMock },
}));
vi.mock("../storage/service", () => ({
	getStorageService: () => ({ delete: storageDeleteMock }),
	uploadFile: uploadFileMock,
}));

const { applicationService } = await import("./service");

const existing = {
	id: "app-1",
	userId: "user-1",
	company: "Stripe",
	role: "Engineer",
	status: "saved" as const,
	activity: [{ id: "e0", type: "stage" as const, stage: "saved" as const, at: new Date("2026-07-01T12:00:00.000Z") }],
	appliedAt: new Date("2026-07-01T12:00:00.000Z"),
	createdAt: new Date("2026-07-01T12:00:00.000Z"),
	resumeFileUrl: "http://localhost:3000/api/uploads/user-1/pictures/resume.pdf",
	coverLetterUrl: "/api/uploads/user-1/pictures/cover.pdf",
};

const createSelectChain = (rows: unknown[]) => ({
	from: () => ({
		where: () => Promise.resolve(rows),
	}),
});

const setSelectResults = (...results: unknown[][]) => {
	dbMock.select.mockReset();
	for (const rows of results) {
		dbMock.select.mockReturnValueOnce(createSelectChain(rows));
	}
	dbMock.select.mockReturnValue(createSelectChain([]));
};

beforeEach(() => {
	dbMock.insert.mockReset();
	dbMock.update.mockReset();
	dbMock.delete.mockReset();
	dbMock.execute.mockReset();
	dbMock.transaction.mockReset();
	dbMock.transaction.mockImplementation((callback) => callback(dbMock));
	resumeGetByIdMock.mockReset();
	storageDeleteMock.mockReset();
	uploadFileMock.mockReset();
	resumeGetByIdMock.mockResolvedValue({ id: "resume-1" });
	storageDeleteMock.mockResolvedValue(true);
	uploadFileMock.mockResolvedValue({
		url: "/api/uploads/user-1/pictures/new.pdf",
		key: "uploads/user-1/pictures/new.pdf",
	});
	setSelectResults([{ ...existing }]);
});

describe("applicationService.create", () => {
	it("seeds an initial stage timeline entry with the chosen date", async () => {
		const values = vi.fn(() => Promise.resolve());
		dbMock.insert.mockReturnValue({ values });

		await applicationService.create({
			userId: "user-1",
			company: "Stripe",
			role: "Engineer",
			status: "applied",
			stageEnteredAt: "2026-07-10",
		} as never);

		const [[inserted]] = values.mock.calls as unknown as [[{ activity: { type: string; stage: string; at: Date }[] }]];
		expect(inserted.activity).toHaveLength(1);
		expect(inserted.activity.at(0)).toMatchObject({ type: "stage", stage: "applied" });
		expect(inserted.activity.at(0)?.at.toISOString()).toBe("2026-07-10T12:00:00.000Z");
	});

	it("checks linked resume ownership before inserting", async () => {
		const values = vi.fn(() => Promise.resolve());
		dbMock.insert.mockReturnValue({ values });

		await applicationService.create({
			userId: "user-1",
			company: "Stripe",
			role: "Engineer",
			resumeId: "resume-1",
		});

		expect(resumeGetByIdMock).toHaveBeenCalledWith({ id: "resume-1", userId: "user-1" });
		expect(values).toHaveBeenCalled();
	});
});

describe("applicationService.update", () => {
	const captureSet = () => {
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...existing }]) }) }));
		dbMock.update.mockReturnValue({ set });
		return set;
	};

	const appendedEvent = (activity: { values: unknown[] }) => {
		const value = activity.values.find((item) => typeof item === "string" && item.includes('"type":"stage"'));
		return JSON.parse(String(value))[0] as { type: string; stage: string };
	};

	it("appends a typed stage timeline entry when the status changes", async () => {
		const set = captureSet();
		await applicationService.update({ id: "app-1", userId: "user-1", status: "applied" });

		const [[arg]] = set.mock.calls as unknown as [[{ activity: { values: unknown[] } }]];
		expect(appendedEvent(arg.activity)).toMatchObject({ type: "stage", stage: "applied" });
	});

	it("does not rewrite activity when the status is unchanged", async () => {
		const set = captureSet();
		await applicationService.update({ id: "app-1", userId: "user-1", notes: "hello" });

		const [[arg]] = set.mock.calls as unknown as [[{ activity?: unknown }]];
		expect(arg.activity).toBeUndefined();
	});

	it("checks linked resume ownership before updating", async () => {
		captureSet();
		await applicationService.update({ id: "app-1", userId: "user-1", resumeId: "resume-1" });

		expect(resumeGetByIdMock).toHaveBeenCalledWith({ id: "resume-1", userId: "user-1" });
	});
});

describe("applicationService timeline entries", () => {
	const captureSet = (returning = [{ ...existing }]) => {
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve(returning) }) }));
		dbMock.update.mockReturnValue({ set });
		return set;
	};

	it("adds dated note timeline entries", async () => {
		const set = captureSet();

		await applicationService.addNote({
			id: "app-1",
			userId: "user-1",
			text: "Recruiter replied",
			date: "2026-07-12",
		} as never);

		const [[arg]] = set.mock.calls as unknown as [[{ activity: { values: unknown[] } }]];
		const value = arg.activity.values.find((item) => typeof item === "string" && item.includes('"type":"note"'));
		const [entry] = JSON.parse(String(value)) as [{ type: string; text: string; at: string }];
		expect(entry).toMatchObject({ type: "note", text: "Recruiter replied" });
		expect(new Date(entry.at).toISOString()).toBe("2026-07-12T12:00:00.000Z");
	});

	it("rejects invalid calendar dates instead of letting Date overflow", async () => {
		await expect(
			applicationService.addNote({
				id: "app-1",
				userId: "user-1",
				text: "Impossible date",
				date: "2026-99-99",
			} as never),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("updates note text and timeline dates", async () => {
		const activity = [
			{ id: "stage-1", type: "stage" as const, stage: "saved" as const, at: new Date("2026-07-01T09:30:00.000Z") },
			{ id: "note-1", type: "note" as const, text: "Old note", at: new Date("2026-07-02T15:45:00.000Z") },
		];
		setSelectResults([{ ...existing, activity }]);
		const set = captureSet();

		await (
			applicationService as unknown as {
				updateTimelineEntry: (input: {
					id: string;
					userId: string;
					entryId: string;
					date?: string;
					text?: string;
				}) => Promise<unknown>;
			}
		).updateTimelineEntry({
			id: "app-1",
			userId: "user-1",
			entryId: "note-1",
			date: "2026-07-10",
			text: "Updated note",
		});

		const [[arg]] = set.mock.calls as unknown as [[{ activity: typeof activity }]];
		expect(arg.activity.find((entry) => entry.id === "note-1")).toMatchObject({
			text: "Updated note",
			at: new Date("2026-07-10T15:45:00.000Z"),
		});
		expect(dbMock.transaction).toHaveBeenCalled();
		expect(dbMock.execute).toHaveBeenCalled();
	});

	it("normalizes JSONB date strings when editing timeline dates", async () => {
		const activity = [
			{ id: "stage-1", type: "stage" as const, stage: "saved" as const, at: "2026-07-01T09:30:00.000Z" },
		];
		setSelectResults([{ ...existing, activity }]);
		const set = captureSet();

		await (
			applicationService as unknown as {
				updateTimelineEntry: (input: { id: string; userId: string; entryId: string; date: string }) => Promise<unknown>;
			}
		).updateTimelineEntry({
			id: "app-1",
			userId: "user-1",
			entryId: "stage-1",
			date: "2026-07-05",
		});

		const [[arg]] = set.mock.calls as unknown as [[{ activity: { id: string; at: Date }[] }]];
		expect(arg.activity.find((entry) => entry.id === "stage-1")?.at.toISOString()).toBe("2026-07-05T09:30:00.000Z");
	});

	it("allows notes to be newer than the current-stage anchor", async () => {
		const activity = [
			{ id: "stage-1", type: "stage" as const, stage: "saved" as const, at: new Date("2026-07-01T12:00:00.000Z") },
			{ id: "note-1", type: "note" as const, text: "Followed up", at: new Date("2026-07-10T12:00:00.000Z") },
		];
		setSelectResults([{ ...existing, activity }]);
		const set = captureSet();

		await (
			applicationService as unknown as {
				updateTimelineEntry: (input: { id: string; userId: string; entryId: string; date: string }) => Promise<unknown>;
			}
		).updateTimelineEntry({ id: "app-1", userId: "user-1", entryId: "stage-1", date: "2026-07-02" });

		const [[arg]] = set.mock.calls as unknown as [[{ activity: { id: string; at: Date }[] }]];
		expect(arg.activity.find((entry) => entry.id === "stage-1")?.at.toISOString()).toBe("2026-07-02T12:00:00.000Z");
	});

	it("blocks moving the current-stage anchor older than another stage", async () => {
		setSelectResults([
			{
				...existing,
				status: "screening",
				activity: [
					{
						id: "stage-1",
						type: "stage" as const,
						stage: "applied" as const,
						at: new Date("2026-07-03T12:00:00.000Z"),
					},
					{
						id: "stage-2",
						type: "stage" as const,
						stage: "screening" as const,
						at: new Date("2026-07-04T12:00:00.000Z"),
					},
				],
			},
		]);

		await expect(
			(
				applicationService as unknown as {
					updateTimelineEntry: (input: {
						id: string;
						userId: string;
						entryId: string;
						date: string;
					}) => Promise<unknown>;
				}
			).updateTimelineEntry({ id: "app-1", userId: "user-1", entryId: "stage-2", date: "2026-07-01" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("blocks deleting the current-stage anchor", async () => {
		setSelectResults([
			{
				...existing,
				status: "screening",
				activity: [
					{
						id: "stage-1",
						type: "stage" as const,
						stage: "applied" as const,
						at: new Date("2026-07-01T12:00:00.000Z"),
					},
					{
						id: "stage-2",
						type: "stage" as const,
						stage: "screening" as const,
						at: new Date("2026-07-03T12:00:00.000Z"),
					},
				],
			},
		]);

		await expect(
			(
				applicationService as unknown as {
					deleteTimelineEntry: (input: { id: string; userId: string; entryId: string }) => Promise<unknown>;
				}
			).deleteTimelineEntry({ id: "app-1", userId: "user-1", entryId: "stage-2" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(dbMock.transaction).toHaveBeenCalled();
		expect(dbMock.execute).toHaveBeenCalled();
	});

	it("deletes older stage entries", async () => {
		setSelectResults([
			{
				...existing,
				status: "screening",
				activity: [
					{
						id: "stage-1",
						type: "stage" as const,
						stage: "applied" as const,
						at: new Date("2026-07-01T12:00:00.000Z"),
					},
					{
						id: "stage-2",
						type: "stage" as const,
						stage: "screening" as const,
						at: new Date("2026-07-03T12:00:00.000Z"),
					},
				],
			},
		]);
		const set = captureSet();

		await (
			applicationService as unknown as {
				deleteTimelineEntry: (input: { id: string; userId: string; entryId: string }) => Promise<unknown>;
			}
		).deleteTimelineEntry({ id: "app-1", userId: "user-1", entryId: "stage-1" });

		const [[arg]] = set.mock.calls as unknown as [[{ activity: { id: string }[] }]];
		expect(arg.activity).toEqual([
			{ id: "stage-2", type: "stage", stage: "screening", at: new Date("2026-07-03T12:00:00.000Z") },
		]);
	});
});

describe("applicationService.delete", () => {
	it("deletes owned uploaded attachments after deleting the application", async () => {
		dbMock.delete.mockReturnValue({
			where: () => ({ returning: () => Promise.resolve([{ id: "app-1" }]) }),
		});

		await applicationService.delete({ id: "app-1", userId: "user-1" });

		expect(storageDeleteMock).toHaveBeenCalledWith("uploads/user-1/pictures/resume.pdf");
		expect(storageDeleteMock).toHaveBeenCalledWith("uploads/user-1/pictures/cover.pdf");
	});
});

describe("applicationService.attachDocument", () => {
	it("uploads a PDF resume document and stores it on the application", async () => {
		setSelectResults([{ ...existing }], [{ ...existing }], []);
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...existing }]) }) }));
		dbMock.update.mockReturnValue({ set });

		await applicationService.attachDocument({
			id: "app-1",
			userId: "user-1",
			kind: "resume",
			fileName: "sent-resume.pdf",
			contentType: "application/pdf",
			data: new Uint8Array([1, 2, 3]),
		});

		expect(uploadFileMock).toHaveBeenCalledWith({
			userId: "user-1",
			contentType: "application/pdf",
			data: new Uint8Array([1, 2, 3]),
		});
		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				resumeFileUrl: "/api/uploads/user-1/pictures/new.pdf",
				resumeFileName: "sent-resume.pdf",
			}),
		);
	});

	it("rejects non-PDF documents before upload", async () => {
		await expect(
			applicationService.attachDocument({
				id: "app-1",
				userId: "user-1",
				kind: "cover-letter",
				fileName: "cover.txt",
				contentType: "text/plain",
				data: new Uint8Array([1]),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		expect(uploadFileMock).not.toHaveBeenCalled();
	});

	it("does not delete the replaced upload when another application still references it", async () => {
		setSelectResults(
			[{ ...existing }],
			[{ ...existing }],
			[
				{
					id: "app-2",
					resumeFileUrl: existing.resumeFileUrl,
					coverLetterUrl: null,
				},
			],
		);
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...existing }]) }) }));
		dbMock.update.mockReturnValue({ set });

		await applicationService.attachDocument({
			id: "app-1",
			userId: "user-1",
			kind: "resume",
			fileName: "sent-resume.pdf",
			contentType: "application/pdf",
			data: new Uint8Array([1, 2, 3]),
		});

		expect(storageDeleteMock).not.toHaveBeenCalledWith("uploads/user-1/pictures/resume.pdf");
	});
});

describe("applicationService.removeDocument", () => {
	it("clears and deletes an owned cover letter document", async () => {
		setSelectResults([{ ...existing }], [{ ...existing }], []);
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...existing }]) }) }));
		dbMock.update.mockReturnValue({ set });

		await applicationService.removeDocument({ id: "app-1", userId: "user-1", kind: "cover-letter" });

		expect(set).toHaveBeenCalledWith(
			expect.objectContaining({
				coverLetterUrl: null,
				coverLetterName: null,
			}),
		);
		expect(storageDeleteMock).toHaveBeenCalledWith("uploads/user-1/pictures/cover.pdf");
	});

	it("does not delete a removed upload while another application still references it", async () => {
		setSelectResults(
			[{ ...existing }],
			[{ ...existing }],
			[
				{
					id: "app-2",
					resumeFileUrl: null,
					coverLetterUrl: existing.coverLetterUrl,
				},
			],
		);
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...existing }]) }) }));
		dbMock.update.mockReturnValue({ set });

		await applicationService.removeDocument({ id: "app-1", userId: "user-1", kind: "cover-letter" });

		expect(storageDeleteMock).not.toHaveBeenCalledWith("uploads/user-1/pictures/cover.pdf");
	});
});

describe("applicationService.bulkDelete", () => {
	it("deletes uploaded attachments for deleted owned applications", async () => {
		setSelectResults(
			[
				{ ...existing, id: "app-1" },
				{
					...existing,
					id: "app-2",
					resumeFileUrl: "http://localhost:3000/api/uploads/user-2/pictures/ignored.pdf",
					coverLetterUrl: null,
				},
			],
			[],
		);
		dbMock.delete.mockReturnValue({
			where: () => ({ returning: () => Promise.resolve([{ id: "app-1" }, { id: "app-2" }]) }),
		});

		const result = await applicationService.bulkDelete({ userId: "user-1", ids: ["app-1", "app-2"] });

		expect(result).toEqual({ deleted: 2 });
		expect(storageDeleteMock).toHaveBeenCalledWith("uploads/user-1/pictures/resume.pdf");
		expect(storageDeleteMock).toHaveBeenCalledWith("uploads/user-1/pictures/cover.pdf");
		expect(storageDeleteMock).not.toHaveBeenCalledWith("uploads/user-2/pictures/ignored.pdf");
	});
});

describe("applicationService interviews", () => {
	const captureSet = (returning = [{ ...existing }]) => {
		const set = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve(returning) }) }));
		dbMock.update.mockReturnValue({ set });
		return set;
	};

	const interview = {
		id: "int-1",
		type: "interview" as const,
		kind: "screening" as const,
		at: new Date("2026-10-01T15:00:00.000Z"),
		durationMinutes: 30,
		location: "Zoom",
		notes: "Recruiter call",
	};

	it("appends an interview entry with the exact scheduled time", async () => {
		const set = captureSet();

		await applicationService.addInterview({
			id: "app-1",
			userId: "user-1",
			at: "2026-10-01T10:30:00-04:00",
			kind: "technical",
			durationMinutes: 90,
			location: "",
			notes: "",
		});

		const [[arg]] = set.mock.calls as unknown as [[{ activity: { values: unknown[] } }]];
		const value = arg.activity.values.find((item) => typeof item === "string" && item.includes('"type":"interview"'));
		const [entry] = JSON.parse(String(value)) as [{ type: string; kind: string; at: string; durationMinutes: number }];
		expect(entry).toMatchObject({ type: "interview", kind: "technical", durationMinutes: 90 });
		expect(new Date(entry.at).toISOString()).toBe("2026-10-01T14:30:00.000Z");
	});

	it("updates only the provided interview fields", async () => {
		setSelectResults([{ ...existing, activity: [...existing.activity, interview] }]);
		const set = captureSet();

		await applicationService.updateInterview({
			id: "app-1",
			userId: "user-1",
			entryId: "int-1",
			at: "2026-10-02T16:00:00.000Z",
			kind: "technical",
			location: undefined,
		});

		const [[arg]] = set.mock.calls as unknown as [[{ activity: (typeof interview)[] }]];
		expect(arg.activity.find((entry) => entry.id === "int-1")).toEqual({
			...interview,
			kind: "technical",
			at: new Date("2026-10-02T16:00:00.000Z"),
		});
		expect(dbMock.transaction).toHaveBeenCalled();
	});

	it("refuses to update a non-interview entry as an interview", async () => {
		await expect(
			applicationService.updateInterview({ id: "app-1", userId: "user-1", entryId: "e0", kind: "technical" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects text edits on interview entries through the generic timeline update", async () => {
		setSelectResults([{ ...existing, activity: [...existing.activity, interview] }]);

		await expect(
			applicationService.updateTimelineEntry({ id: "app-1", userId: "user-1", entryId: "int-1", text: "Nope" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
