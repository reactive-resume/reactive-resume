import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB layer; the logic under test is the activity-timeline bookkeeping, not SQL.
const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	transaction: vi.fn(),
}));
const resumeGetByIdMock = vi.hoisted(() => vi.fn());
const writeVersionMock = vi.hoisted(() => vi.fn());
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
vi.mock("../resume/version-history", () => ({ writeVersion: writeVersionMock }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: { getById: vi.fn(), recordSent: vi.fn() } }));
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

// Awaitable directly, or after `.for("update")` for the reads that lock their row.
const createSelectChain = (rows: unknown[]) => ({
	from: () => ({
		where: () => Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) }),
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
	dbMock.transaction.mockReset();
	dbMock.transaction.mockImplementation((callback) => callback(dbMock));
	resumeGetByIdMock.mockReset();
	writeVersionMock.mockReset();
	writeVersionMock.mockResolvedValue({ id: "version-1" });
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
		const values = vi.fn(() => ({ returning: () => Promise.resolve([]) }));
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

	it("checks linked resume ownership before updating", async () => {
		captureSet();
		await applicationService.update({ id: "app-1", userId: "user-1", resumeId: "resume-1" });

		expect(resumeGetByIdMock).toHaveBeenCalledWith({ id: "resume-1", userId: "user-1" });
	});

	it("keeps a reason when closing, and clears it and the archive flag on any other stage", async () => {
		setSelectResults([existing], [existing]);
		const set = captureSet();
		await applicationService.update({ id: "app-1", userId: "user-1", status: "closed", closedReason: "withdrew" });
		await applicationService.update({ id: "app-1", userId: "user-1", status: "applied" });

		const [[closing], [reopening]] = set.mock.calls as unknown as [
			[Record<string, unknown>],
			[Record<string, unknown>],
		];
		expect(closing).toMatchObject({ status: "closed", closedReason: "withdrew" });
		expect(reopening).toMatchObject({ status: "applied", closedReason: null });
	});
});

describe("applicationService sent resume", () => {
	const sentRow = { ...existing, status: "applied" as const, resumeId: "resume-1", sentResumeVersionId: null };

	it.each(["resume", "coverLetter"] as const)(
		"retains recorded submitted %s linkage when preparing another document",
		async (kind) => {
			setSelectResults([
				{
					...sentRow,
					sentResumeVersionId: "sent-resume",
					coverLetterId: "letter-1",
					sentCoverLetterVersionId: "sent-letter",
				},
			]);
			await expect(
				applicationService.update({
					id: "app-1",
					userId: "user-1",
					...(kind === "resume" ? { resumeId: "resume-2" } : { coverLetterId: "letter-2" }),
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
			expect(dbMock.update).not.toHaveBeenCalled();
		},
	);

	it.each(["stage", "resume"] as const)(
		"saves the sent version and score when the %s is linked at Applied",
		async (field) => {
			const data = structuredClone((await import("@reactive-resume/schema/resume/default")).defaultResumeData);
			resumeGetByIdMock.mockResolvedValue({ id: "resume-1", data });
			const setSent = vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...sentRow }]) }) }));
			dbMock.update.mockReturnValueOnce({
				set: vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([sentRow]) }) })),
			});
			dbMock.update.mockReturnValueOnce({ set: setSent });

			await applicationService.update({
				id: "app-1",
				userId: "user-1",
				...(field === "stage" ? { status: "applied" as const } : { resumeId: "resume-1" }),
			});

			expect(writeVersionMock).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ resumeId: "resume-1", kind: "sent", name: "Stripe", data }),
			);
			expect(setSent).toHaveBeenCalledWith({ sentResumeVersionId: "version-1", sentCheckScore: expect.any(Number) });
		},
	);

	it("saves it once, and not before the application is sent", async () => {
		setSelectResults([existing], [existing]);
		const set = vi.fn(() => ({
			where: () => ({ returning: () => Promise.resolve([{ ...sentRow, sentResumeVersionId: "v0" }]) }),
		}));
		dbMock.update.mockReturnValue({ set });
		await applicationService.update({ id: "app-1", userId: "user-1", notes: "again" });

		dbMock.update.mockReturnValue({
			set: vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([{ ...sentRow, status: "saved" }]) }) })),
		});
		await applicationService.update({ id: "app-1", userId: "user-1", status: "saved" });

		expect(writeVersionMock).not.toHaveBeenCalled();
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
	});
});

describe("applicationService.attachDocument", () => {
	it("rejects non-PDF documents before upload", async () => {
		await expect(
			applicationService.attachDocument({
				id: "app-1",
				userId: "user-1",
				kind: "cover-letter",
				file: new File(["text"], "cover.txt", { type: "text/plain" }),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		expect(uploadFileMock).not.toHaveBeenCalled();
	});

	it("does not delete the replaced upload when another application still references it", async () => {
		setSelectResults(
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
			file: new File(["%PDF"], "sent-resume.pdf", { type: "application/pdf" }),
		});

		expect(storageDeleteMock).not.toHaveBeenCalledWith("uploads/user-1/pictures/resume.pdf");
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
});

describe("application attachment lifecycle", () => {
	const pdf = (name: string) => new File(["%PDF-1.4"], name, { type: "application/pdf" });
	const newUrl = "/api/uploads/user-1/pictures/new.pdf";
	const newKey = "uploads/user-1/pictures/new.pdf";

	function storedApplication(shared = false, fail = false) {
		let row: Record<string, unknown> = { ...existing };
		dbMock.select.mockImplementation(() => ({
			from: () => ({ where: () => Promise.resolve([row, ...(shared ? [{ ...existing, id: "app-2" }] : [])]) }),
		}));
		const save = (fields: Record<string, unknown>) => ({
			returning: async () => {
				if (fail) throw new Error("save failed");
				row = { ...row, ...fields };
				return [row];
			},
		});
		dbMock.insert.mockImplementation(() => ({ values: save }));
		dbMock.update.mockImplementation(() => ({
			set: (fields: Record<string, unknown>) => ({ where: () => save(fields) }),
		}));
		return () => row;
	}

	it.each(["create", "update"] as const)("%s rolls back uploads after a failed record write", async (operation) => {
		const row = storedApplication(false, true);
		await expect(
			applicationService[operation]({
				userId: "user-1",
				id: "app-1",
				company: "Stripe",
				role: "Engineer",
				resumeFile: pdf("new.pdf"),
			}),
		).rejects.toThrow("save failed");
		expect(uploadFileMock).toHaveBeenCalledOnce();
		expect(storageDeleteMock).toHaveBeenCalledExactlyOnceWith(newKey);
		expect(row().resumeFileUrl).toBe(existing.resumeFileUrl);
	});

	it("cleans the first upload when the second fails, without starting a record write", async () => {
		storedApplication();
		// Let the first file succeed, then reject the second.
		uploadFileMock
			.mockReset()
			.mockResolvedValueOnce({ url: newUrl, key: newKey })
			.mockRejectedValueOnce(new Error("upload failed"));
		await expect(
			applicationService.create({
				userId: "user-1",
				company: "Stripe",
				role: "Engineer",
				resumeFile: pdf("new.pdf"),
				coverLetterFile: pdf("cover.pdf"),
			}),
		).rejects.toThrow("upload failed");
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(storageDeleteMock).toHaveBeenCalledExactlyOnceWith(newKey);
	});

	it.each([false, true])(
		"replacement deletes old storage only after save, with shared reference=%s",
		async (shared) => {
			const row = storedApplication(shared);
			storageDeleteMock.mockImplementation(async (key: string) => {
				expect(row().resumeFileUrl).toBe(newUrl);
				expect(key).toBe("uploads/user-1/pictures/resume.pdf");
				return true;
			});
			await applicationService.update({ id: "app-1", userId: "user-1", resumeFile: pdf("new.pdf") });
			expect(row().resumeFileUrl).toBe(newUrl);
			expect(row().resumeFileName).toBe("new.pdf");
			expect(row()).not.toHaveProperty("resumeFile");
			expect(storageDeleteMock).toHaveBeenCalledTimes(shared ? 0 : 1);
		},
	);

	it("does not roll back a committed attachment if recording its sent version fails", async () => {
		const row = storedApplication();
		writeVersionMock.mockRejectedValueOnce(new Error("snapshot failed"));
		await expect(
			applicationService.update({
				id: "app-1",
				userId: "user-1",
				status: "applied",
				resumeId: "resume-1",
				resumeFile: pdf("new.pdf"),
			}),
		).rejects.toThrow("snapshot failed");
		expect(row().resumeFileUrl).toBe(newUrl);
		expect(storageDeleteMock).not.toHaveBeenCalledWith(newKey);
	});

	it("removal commits before deleting the old file", async () => {
		const row = storedApplication();
		storageDeleteMock.mockImplementation(async () => {
			expect(row().resumeFileUrl).toBeNull();
			return true;
		});
		await applicationService.removeDocument({ id: "app-1", userId: "user-1", kind: "resume" });
		expect(row().resumeFileUrl).toBeNull();
		expect(storageDeleteMock).toHaveBeenCalledExactlyOnceWith("uploads/user-1/pictures/resume.pdf");
	});
});
