import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

// The DB layer and side-effecting helpers are mocked; the branching in service.ts is what's under test.

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	transaction: vi.fn(),
	update: vi.fn(),
}));
const compareMock = vi.hoisted(() => vi.fn());
const publishResumeUpdatedMock = vi.hoisted(() => vi.fn());
const grantResumeAccessMock = vi.hoisted(() => vi.fn());

vi.mock("../cover-letters/embedded", () => ({ adoptEmbeddedLetters: vi.fn(async () => undefined) }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	resume: {
		id: "id",
		userId: "user_id",
		slug: "slug",
		name: "name",
		tags: "tags",
		data: "data",
		isPublic: "is_public",
		showDownloadButtons: "show_download_buttons",
		isLocked: "is_locked",
		password: "password",
		trashedAt: "trashed_at",
		updatedAt: "updated_at",
		createdAt: "created_at",
	},
	resumeStatistics: {
		resumeId: "resume_id",
		views: "views",
		downloads: "downloads",
		lastViewedAt: "last_viewed_at",
		lastDownloadedAt: "last_downloaded_at",
	},
	resumeStatisticsDaily: {
		resumeId: "resume_id",
		date: "date",
		views: "views",
		downloads: "downloads",
	},
	resumeVersion: {
		id: "id",
		resumeId: "resume_id",
		userId: "user_id",
		data: "data",
		createdAt: "created_at",
	},
	user: { id: "id", username: "username" },
}));
vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => a,
	arrayContains: (...a: unknown[]) => a,
	asc: (x: unknown) => x,
	desc: (x: unknown) => x,
	eq: (...a: unknown[]) => a,
	gte: (...a: unknown[]) => a,
	isNotNull: (...a: unknown[]) => a,
	isNull: (...a: unknown[]) => a,
	notInArray: (...a: unknown[]) => a,
	sql: Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }), {
		join: (values: unknown[]) => values,
	}),
}));
vi.mock("bcryptjs", () => ({ hash: vi.fn(async () => "hashed-password"), compare: compareMock }));
vi.mock("./events", () => ({ publishResumeUpdated: publishResumeUpdatedMock }));
vi.mock("./access", () => ({
	grantResumeAccess: grantResumeAccessMock,
	hasResumeAccess: vi.fn(),
}));
vi.mock("../storage/service", () => ({
	getStorageService: () => ({ delete: vi.fn() }),
}));
// Version history and slugs have their own tests; here they only need to be called at the right moments.
const versionHistoryMock = vi.hoisted(() => ({
	writeVersion: vi.fn(),
	saveSessionVersion: vi.fn(),
	getVersion: vi.fn(),
	listVersions: vi.fn(),
	renameVersion: vi.fn(),
	deleteVersion: vi.fn(),
}));
vi.mock("./version-history", () => versionHistoryMock);
const recordSlugChangeMock = vi.hoisted(() => vi.fn());
// The lookup by username and slug; its query is tested against real SQL in public-pdf.test.ts.
const findResumeMock = vi.hoisted(() => vi.fn());
vi.mock("./slugs", () => ({
	SLUG_PATTERN: /^[a-z0-9]+(-[a-z0-9]+)*$/,
	checkSlug: vi.fn(),
	findFreeSlug: vi.fn(async () => "generated-slug"),
	findResume: findResumeMock,
	recordSlugChange: recordSlugChangeMock,
}));

const { resumeService } = await import("./service");
const { parseStoredResumeData } = await import("./resume-data-validation");

// A `db.update(...).set(...).where(...).returning(...)` chain that resolves to `rows`.
const createUpdateChain = (rows: unknown[]) => {
	const returning = vi.fn(() => Promise.resolve(rows));
	const where = vi.fn((_condition?: unknown) => ({ returning }));
	const set = vi.fn((_input: unknown) => ({ where }));
	return { chain: { set }, set, where, returning };
};

// A `db.select(...).from(...).where(...)` chain that resolves to `rows`.
const createSelectChain = (rows: unknown[]) => ({
	from: () => ({ where: () => Promise.resolve(rows) }),
});

const createLockedSelectChain = (rows: unknown[]) => {
	const forUpdate = vi.fn(() => Promise.resolve(rows));
	return {
		chain: { from: () => ({ where: () => ({ for: forUpdate }) }) },
		forUpdate,
	};
};

const createSemanticResumeData = (): ResumeData => {
	const data: ResumeData = structuredClone(defaultResumeData);
	data.metadata.stylesheet = {
		mode: "semantic",
		source: { languageVersion: 1, text: "@version 1;\n" },
	};
	return data;
};

const createResumeRow = (data: ResumeData, updatedAt = new Date()) => ({
	id: "r1",
	name: "Resume",
	slug: "resume",
	tags: [],
	data,
	isPublic: false,
	isLocked: false,
	updatedAt,
	hasPassword: false,
});

const createRestoreHarness = (currentData: ResumeData, restoredData: ResumeData) => {
	const currentRow = createResumeRow(currentData);
	dbMock.select.mockReturnValueOnce(createSelectChain([currentRow]));
	versionHistoryMock.getVersion.mockImplementationOnce(async () => ({ data: parseStoredResumeData(restoredData) }));

	const lockedSelect = createLockedSelectChain([
		{
			data: currentData,
			isLocked: false,
			updatedAt: currentRow.updatedAt,
		},
	]);
	let persistedData: ResumeData | undefined;
	const returning = vi.fn(() =>
		Promise.resolve([createResumeRow(persistedData ?? restoredData, new Date("2026-01-02T00:00:00Z"))]),
	);
	const where = vi.fn(() => ({ returning }));
	const set = vi.fn((values: { data: ResumeData }) => {
		persistedData = values.data;
		return { where };
	});
	dbMock.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
		callback({ select: () => lockedSelect.chain, update: () => ({ set }) }),
	);
};

beforeEach(() => {
	dbMock.select.mockReset();
	dbMock.transaction.mockReset();
	dbMock.update.mockReset();
	compareMock.mockReset();
	publishResumeUpdatedMock.mockReset();
	grantResumeAccessMock.mockReset();
	for (const mock of Object.values(versionHistoryMock)) mock.mockReset();
	versionHistoryMock.writeVersion.mockResolvedValue({ id: "v" });
	versionHistoryMock.saveSessionVersion.mockResolvedValue(undefined);
	recordSlugChangeMock.mockReset();
	findResumeMock.mockReset();
	publishResumeUpdatedMock.mockResolvedValue(undefined);
});

describe("versions.restore", () => {
	it("saves the current state as Before restore first, then marks the restore", async () => {
		const currentData = createSemanticResumeData();
		const restoredData = createSemanticResumeData();
		restoredData.basics.name = "Restored";
		createRestoreHarness(currentData, restoredData);

		await resumeService.versions.restore({ resumeId: "r1", versionId: "v1", userId: "u1" });

		expect(versionHistoryMock.writeVersion.mock.calls.map(([, input]) => input.kind)).toEqual([
			"before-restore",
			"restored",
		]);
		expect(versionHistoryMock.writeVersion.mock.calls[0]?.[1].data).toEqual(currentData);
		expect(versionHistoryMock.saveSessionVersion).not.toHaveBeenCalled();
	});
});

describe("update", () => {
	const updateHarness = (existing: { slug: string; updatedAt?: Date }) => {
		const row = { ...createResumeRow(defaultResumeData, existing.updatedAt), slug: existing.slug };
		const select = createLockedSelectChain([row]);
		const update = createUpdateChain([row]);
		const tx = { select: () => select.chain, update: () => update.chain };
		dbMock.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));
		return { tx, update };
	};

	it.each(["stale", "current", "omitted"] as const)(
		"guards full saves against overwriting a newer version: %s timestamp",
		async (version) => {
			const updatedAt = new Date("2026-10-17T10:00:00.123Z");
			const { update } = updateHarness({ slug: "resume", updatedAt });
			const input = {
				id: "r1",
				userId: "u1",
				name: "Saved",
				...(version === "omitted"
					? {}
					: { expectedUpdatedAt: version === "stale" ? new Date(updatedAt.getTime() - 1) : updatedAt }),
			};

			if (version === "stale") {
				await expect(resumeService.update(input)).rejects.toMatchObject({
					code: "RESUME_VERSION_CONFLICT",
					status: 409,
					data: { updatedAt: "2026-10-17T10:00:00.123Z" },
				});
				expect(update.set).not.toHaveBeenCalled();
				expect(publishResumeUpdatedMock).not.toHaveBeenCalled();
			} else {
				await expect(resumeService.update(input)).resolves.toMatchObject({ id: "r1" });
				expect(update.set).toHaveBeenCalledWith({ name: "Saved", autoName: false });
				expect(update.where).toHaveBeenCalledWith(expect.arrayContaining([["trashed_at"], ["is_locked", false]]));
			}
		},
	);

	it("keeps the old address as a redirect when the slug changes", async () => {
		const { tx, update } = updateHarness({ slug: "old-address" });

		await resumeService.update({ id: "r1", userId: "u1", slug: "new-address" });

		expect(recordSlugChangeMock).toHaveBeenCalledWith(tx, {
			userId: "u1",
			resumeId: "r1",
			from: "old-address",
			to: "new-address",
		});
		expect(update.set).toHaveBeenCalledWith({ slug: "new-address" });
	});

	it("rejects a new slug outside the pattern, but accepts an unchanged legacy one", async () => {
		updateHarness({ slug: "Legacy_Slug" });
		await expect(resumeService.update({ id: "r1", userId: "u1", slug: "Not Valid" })).rejects.toMatchObject({
			code: "INVALID_SLUG",
			status: 400,
		});

		const { update } = updateHarness({ slug: "Legacy_Slug" });
		await resumeService.update({ id: "r1", userId: "u1", name: "Renamed", slug: "Legacy_Slug" });
		// A name typed by hand also ends automatic naming.
		expect(update.set).toHaveBeenCalledWith({ name: "Renamed", autoName: false, slug: "Legacy_Slug" });
		expect(recordSlugChangeMock).not.toHaveBeenCalled();
	});

	it("throws RESUME_LOCKED when the pre-read reports the resume is locked", async () => {
		const select = createLockedSelectChain([{ data: defaultResumeData, isLocked: true, updatedAt: new Date() }]);
		dbMock.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
			callback({ select: () => select.chain }),
		);

		await expect(resumeService.update({ id: "r1", userId: "u1", name: "New" })).rejects.toMatchObject({
			code: "RESUME_LOCKED",
			status: 403,
		});
		expect(select.forUpdate).toHaveBeenCalledWith("update");
	});

	it("does not update a resume in Trash", async () => {
		const selectWhere = vi.fn((_condition: unknown) => ({ for: vi.fn(() => Promise.resolve([])) }));
		const update = createUpdateChain([]);
		const tx = { select: () => ({ from: () => ({ where: selectWhere }) }), update: () => update.chain };
		dbMock.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));

		await expect(resumeService.update({ id: "r1", userId: "u1", name: "Updated" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(selectWhere.mock.calls[0]?.[0]).toContainEqual(["trashed_at"]);
		expect(update.set).not.toHaveBeenCalled();
	});
});

describe("patch", () => {
	const createPatchTx = (existing: { data: ResumeData; isLocked: boolean; updatedAt: Date }) => {
		const lockedSelect = createLockedSelectChain([existing]);
		const row = createResumeRow(existing.data, existing.updatedAt);
		const update = createUpdateChain([row]);
		update.returning.mockImplementation(() => {
			const written = update.set.mock.calls.at(-1)?.[0] as { data: ResumeData };
			return Promise.resolve([{ ...row, data: written.data }]);
		});
		const versionSelect = {
			from: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }) }) }),
		};
		const tx = {
			select: vi.fn().mockReturnValueOnce(lockedSelect.chain).mockReturnValueOnce(versionSelect),
			update: vi.fn(() => update.chain),
			insert: vi.fn(() => ({ values: vi.fn(() => Promise.resolve()) })),
			delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
		};

		return { tx, update };
	};

	it.each([["/metadata/page/marginX", 500]] as const)(
		"rejects an invalid patch at %s atomically",
		async (path, value) => {
			const data = structuredClone(defaultResumeData);
			data.metadata.page.marginX = 40;
			const before = structuredClone(data);
			const { tx, update } = createPatchTx({ data, isLocked: false, updatedAt: new Date() });
			await expect(
				resumeService.patchInTransaction(tx as never, {
					id: "r1",
					userId: "u1",
					operations: [
						{ op: "replace", path: "/basics/name", value: "Must not persist" },
						{ op: "replace", path, value },
					],
				}),
			).rejects.toMatchObject({ code: "INVALID_PATCH_OPERATIONS", status: 400 });
			expect(update.set).not.toHaveBeenCalled();
			expect(tx.insert).not.toHaveBeenCalled();
			expect(data).toEqual(before);
		},
	);

	it("normalizes stored legacy data before validating newly submitted patch values", async () => {
		const data = structuredClone(defaultResumeData);
		data.metadata.page.marginX = 500;
		const { tx, update } = createPatchTx({ data, isLocked: false, updatedAt: new Date() });
		await resumeService.patchInTransaction(tx as never, {
			id: "r1",
			userId: "u1",
			operations: [{ op: "replace", path: "/basics/name", value: "Ada" }],
		});
		expect(update.set).toHaveBeenCalledWith({
			data: expect.objectContaining({
				basics: expect.objectContaining({ name: "Ada" }),
				metadata: expect.objectContaining({ page: expect.objectContaining({ marginX: 14 }) }),
			}),
		});
		expect(update.where).toHaveBeenCalledWith(expect.arrayContaining([["trashed_at"], ["is_locked", false]]));
	});

	it.each([
		{
			name: "path",
			operation: { op: "add" as const, path: "/metadata/~2stylesheet", value: "invalid escape" },
		},
		{
			name: "from",
			operation: {
				op: "copy" as const,
				from: "/metadata/notes~",
				path: "/metadata/notes",
			},
		},
	])("rejects malformed JSON Pointer escapes in $name before applying", async ({ operation }) => {
		const data = createSemanticResumeData();
		const { tx, update } = createPatchTx({
			data,
			isLocked: false,
			updatedAt: new Date(),
		});

		const error = await resumeService
			.patchInTransaction(tx as never, {
				id: "r1",
				userId: "u1",
				operations: [operation],
			})
			.catch((caught: unknown) => caught);

		expect(error).toMatchObject({
			code: "INVALID_PATCH_OPERATIONS",
			message: expect.stringContaining("valid JSON Pointer"),
		});
		expect((error as { data: unknown }).data).toEqual({ index: 0, operation });
		expect(update.set).not.toHaveBeenCalled();
	});

	it("does not patch a resume in Trash", async () => {
		const selectWhere = vi.fn((_condition: unknown) => ({ for: vi.fn(() => Promise.resolve([])) }));
		const tx = {
			select: vi.fn(() => ({ from: () => ({ where: selectWhere }) })),
			update: vi.fn(),
		};

		await expect(
			resumeService.patchInTransaction(tx as never, {
				id: "r1",
				userId: "u1",
				operations: [{ op: "replace", path: "/basics/name", value: "Ada" }],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(selectWhere.mock.calls[0]?.[0]).toContainEqual(["trashed_at"]);
		expect(tx.update).not.toHaveBeenCalled();
	});
});

describe("verifyPassword", () => {
	it("throws INVALID_PASSWORD when bcrypt.compare returns false", async () => {
		findResumeMock.mockResolvedValueOnce({ id: "r1", password: "hash" });
		compareMock.mockResolvedValueOnce(false);

		await expect(
			resumeService.verifyPassword({ slug: "s", username: "u", password: "p", responseHeaders: new Headers() }),
		).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
		expect(grantResumeAccessMock).not.toHaveBeenCalled();
	});

	it("checks a password even when no shared resume matches, so timing doesn't reveal which exist", async () => {
		compareMock.mockResolvedValueOnce(true);

		await expect(
			resumeService.verifyPassword({ slug: "s", username: "u", password: "p", responseHeaders: new Headers() }),
		).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
		expect(compareMock).toHaveBeenCalledOnce();
		expect(grantResumeAccessMock).not.toHaveBeenCalled();
	});
});

describe("delete", () => {
	const runTransaction = (tx: unknown) => {
		dbMock.transaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));
	};

	it("throws RESUME_LOCKED when the row is locked", async () => {
		runTransaction({
			select: vi
				.fn()
				.mockReturnValueOnce(createLockedSelectChain([{ id: "u1" }]).chain)
				.mockReturnValueOnce(createSelectChain([{ isLocked: true }])),
		});

		await expect(resumeService.delete({ id: "r1", userId: "u1" })).rejects.toMatchObject({
			code: "RESUME_LOCKED",
			status: 403,
		});
	});

	it("allows permanently deleting a resume that is in Trash", async () => {
		const deleteWhere = vi.fn((_condition?: unknown) => Promise.resolve());
		const selectWhere = vi.fn((_condition?: unknown) => Promise.resolve([{ isLocked: false }]));
		runTransaction({
			select: vi
				.fn()
				.mockReturnValueOnce(createLockedSelectChain([{ id: "u1" }]).chain)
				.mockReturnValueOnce({ from: () => ({ where: selectWhere }) }),
			delete: () => ({ where: deleteWhere }),
		});

		await expect(resumeService.delete({ id: "r1", userId: "u1" })).resolves.toBeUndefined();
		expect(selectWhere).toHaveBeenCalledTimes(1);
		expect(selectWhere.mock.calls[0]?.[0]).not.toContainEqual(["trashed_at"]);
		expect(deleteWhere).toHaveBeenCalledTimes(1);
		expect(deleteWhere.mock.calls[0]?.[0]).not.toContainEqual(["trashed_at"]);
	});
});

describe.each([
	{
		name: "setPassword",
		run: () => resumeService.setPassword({ id: "r1", userId: "u1", password: "newPassword123" }),
		written: "hashed-password",
	},
	{ name: "removePassword", run: () => resumeService.removePassword({ id: "r1", userId: "u1" }), written: null },
])("$name", ({ run, written }) => {
	it("writes the password when the resume is unlocked", async () => {
		const update = createUpdateChain([{ id: "r1", updatedAt: new Date() }]);
		dbMock.update.mockReturnValueOnce(update.chain);

		await expect(run()).resolves.toBeUndefined();
		expect(update.set).toHaveBeenCalledWith({ password: written });
		expect(update.where).toHaveBeenCalledWith(expect.arrayContaining([["trashed_at"], ["is_locked", false]]));
	});

	it.each([
		{ code: "RESUME_LOCKED", rows: [{ id: "r1" }] },
		{ code: "NOT_FOUND", rows: [] },
	])("throws $code when no unlocked row matches", async ({ code, rows }) => {
		dbMock.update.mockReturnValueOnce(createUpdateChain([]).chain);
		dbMock.select.mockReturnValueOnce(createSelectChain(rows));

		await expect(run()).rejects.toMatchObject({ code });
	});

	it("does not update password for a resume in Trash", async () => {
		const update = createUpdateChain([]);
		dbMock.update.mockReturnValueOnce(update.chain);
		const selectWhere = vi.fn((_cond: unknown) => Promise.resolve([]));
		dbMock.select.mockReturnValueOnce({ from: () => ({ where: selectWhere }) });

		await expect(run()).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(update.where).toHaveBeenCalledWith(expect.arrayContaining([["trashed_at"]]));
		expect(selectWhere).toHaveBeenCalledWith(expect.arrayContaining([["trashed_at"]]));
	});
});

describe("getBySlug", () => {
	it.each(["u1", "other-user"])("password gate exempts only the owner (%s)", async (currentUserId) => {
		findResumeMock.mockResolvedValueOnce({
			...createResumeRow(defaultResumeData),
			userId: "u1",
			isPublic: true,
			hasPassword: true,
			passwordHash: "hash",
		});
		const request = resumeService.getBySlug({
			username: "owner",
			slug: "resume",
			currentUserId,
			requestHeaders: new Headers(),
		});
		if (currentUserId === "u1") await expect(request).resolves.toMatchObject({ id: "r1" });
		else await expect(request).rejects.toMatchObject({ code: "NEED_PASSWORD", status: 401 });
	});

	it("hides a private resume from an anonymous visitor", async () => {
		const row = {
			...createResumeRow(defaultResumeData),
			userId: "u1",
			isPublic: false,
			hasPassword: false,
			passwordHash: null,
		};
		findResumeMock.mockResolvedValue(row);
		await expect(
			resumeService.getBySlug({
				username: "owner",
				slug: "resume",
				requestHeaders: new Headers(),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("statistics.recordDownload", () => {
	it("lets the owner download a password-protected resume without an unlock cookie", async () => {
		findResumeMock.mockResolvedValueOnce({ id: "r1", userId: "u1", isPublic: true, passwordHash: "hash" });
		await expect(
			resumeService.statistics.recordDownload({
				username: "owner",
				slug: "resume",
				currentUserId: "u1",
				requestHeaders: new Headers(),
			}),
		).resolves.toBe(true);
	});

	it("requires password when downloading via renamed slug", async () => {
		findResumeMock.mockResolvedValueOnce({ id: "r1", userId: "u1", isPublic: true, passwordHash: "hash" });
		await expect(
			resumeService.statistics.recordDownload({
				username: "owner",
				slug: "old-slug",
				requestHeaders: new Headers(),
			}),
		).rejects.toMatchObject({
			code: "NEED_PASSWORD",
			data: { username: "owner", slug: "old-slug" },
		});
	});

	it("throws NOT_FOUND when renamed slug redirect has expired or does not exist", async () => {
		await expect(
			resumeService.statistics.recordDownload({
				username: "owner",
				slug: "expired-slug",
				requestHeaders: new Headers(),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("statistics.getById", () => {
	it("does not look in Trash for the resume", async () => {
		const where = vi.fn((_condition: unknown) => Promise.resolve([]));
		dbMock.select.mockReturnValueOnce({ from: () => ({ rightJoin: () => ({ where }) }) });

		await expect(resumeService.statistics.getById({ id: "r1", userId: "u1" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(where.mock.calls[0]?.[0]).toContainEqual(["trashed_at"]);
	});
});

describe("statistics.getDailySeries", () => {
	it("does not look in Trash for the resume", async () => {
		const where = vi.fn((_condition: unknown) => Promise.resolve([]));
		dbMock.select.mockReturnValueOnce({ from: () => ({ where }) });

		await expect(resumeService.statistics.getDailySeries({ id: "r1", userId: "u1" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(where.mock.calls[0]?.[0]).toContainEqual(["trashed_at"]);
	});
});

describe("tags.list", () => {
	it("does not include tags from resumes in Trash", async () => {
		const where = vi.fn((_condition: unknown) => Promise.resolve([{ tags: ["tag1", "tag2"] }]));
		dbMock.select.mockReturnValueOnce({ from: () => ({ where }) });

		const result = await resumeService.tags.list({ userId: "u1" });
		expect(result).toEqual(["tag1", "tag2"]);
		expect(where.mock.calls[0]?.[0]).toContainEqual(["trashed_at"]);
	});
});

describe("getById", () => {
	it("reads a resume in Trash so its thumbnail can render", async () => {
		const where = vi.fn((_condition: unknown) => Promise.resolve([]));
		dbMock.select.mockReturnValueOnce({ from: () => ({ where }) });

		await expect(resumeService.getById({ id: "r1", userId: "u1" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(where.mock.calls[0]?.[0]).not.toContainEqual(["trashed_at"]);
	});
});

describe("setLocked", () => {
	it("does not allow locking or unlocking a resume in Trash", async () => {
		const update = createUpdateChain([]);
		dbMock.update.mockReturnValueOnce(update.chain);

		await expect(resumeService.setLocked({ id: "r1", userId: "u1", isLocked: true })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(update.where).toHaveBeenCalledWith(expect.arrayContaining([["trashed_at"]]));
	});
});
