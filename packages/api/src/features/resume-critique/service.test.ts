import { beforeEach, describe, expect, it, vi } from "vitest";

// Characterization tests for the critique service's access gating and ownership scoping —
// the parts most likely to regress silently (a missing WHERE clause here leaks one
// critiquer's comments to another, or lets a non-owner resolve comments). The DB layer and
// cookie/bcrypt helpers are mocked; the branching in service.ts is what's under test.

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	insert: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
}));
const hashMock = vi.hoisted(() => vi.fn());
const compareMock = vi.hoisted(() => vi.fn());
const readCritiquerIdFromCookieMock = vi.hoisted(() => vi.fn());
const grantCritiquerCookieMock = vi.hoisted(() => vi.fn());
const generateIdMock = vi.hoisted(() => vi.fn(() => "generated-id"));

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	resume: { id: "id", userId: "user_id", slug: "slug", isPublic: "is_public", critiqueEnabled: "critique_enabled" },
	resumeCritiqueCritiquer: {
		id: "id",
		resumeId: "resume_id",
		resumeOwnerUserId: "resume_owner_user_id",
		displayName: "display_name",
		lastSeenAt: "last_seen_at",
	},
	resumeCritiqueComment: {
		id: "id",
		resumeId: "resume_id",
		critiquerId: "critiquer_id",
		resumeOwnerUserId: "resume_owner_user_id",
		status: "status",
		createdAt: "created_at",
	},
	user: { id: "id", username: "username" },
}));
vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => a,
	eq: (...a: unknown[]) => a,
	desc: (x: unknown) => x,
	isNotNull: (...a: unknown[]) => a,
}));
vi.mock("bcrypt", () => ({ hash: hashMock, compare: compareMock }));
vi.mock("@reactive-resume/utils/string", () => ({ generateId: generateIdMock }));
vi.mock("../resume/critique-access", () => ({
	readCritiquerIdFromCookie: readCritiquerIdFromCookieMock,
	grantCritiquerCookie: grantCritiquerCookieMock,
}));

const { resumeCritiqueService } = await import("./service");

const eligibleResumeRow = {
	id: "resume-1",
	userId: "owner-1",
	name: "Resume",
	data: {},
	critiquePassword: "hashed-password",
};

// A `db.select(...).from(...).innerJoin(...).where(...)` chain resolving to `rows`.
const selectJoinChain = (rows: unknown[]) => ({
	from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }),
});

// A `db.select(...).from(...).where(...)` chain resolving to `rows`. `where()` itself resolves
// (for plain lookups) and also exposes `.orderBy()` (for the ordered comments query).
const selectChain = (rows: unknown[]) => {
	const result = Promise.resolve(rows) as Promise<unknown[]> & { orderBy: () => Promise<unknown[]> };
	result.orderBy = () => Promise.resolve(rows);
	return { from: () => ({ where: () => result }) };
};

const updateChain = (rows: unknown[]) => ({
	set: () => ({ where: () => ({ returning: () => Promise.resolve(rows) }) }),
});

const insertChain = (rows: unknown[]) => ({ values: () => ({ returning: () => Promise.resolve(rows) }) });

const deleteChain = (rows: unknown[]) => ({ where: () => ({ returning: () => Promise.resolve(rows) }) });

beforeEach(() => {
	vi.clearAllMocks();
});

describe("setEnabled", () => {
	it("rejects enabling critique mode when the resume is not public", async () => {
		dbMock.select.mockReturnValueOnce(selectChain([{ isPublic: false }]));

		await expect(
			resumeCritiqueService.setEnabled({ id: "resume-1", userId: "owner-1", critiqueEnabled: true }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(dbMock.update).not.toHaveBeenCalled();
	});

	it("enables critique mode when the resume is public", async () => {
		dbMock.select.mockReturnValueOnce(selectChain([{ isPublic: true }]));
		dbMock.update.mockReturnValueOnce(updateChain([{ critiqueEnabled: true }]));

		const result = await resumeCritiqueService.setEnabled({ id: "resume-1", userId: "owner-1", critiqueEnabled: true });
		expect(result).toEqual({ critiqueEnabled: true });
	});

	it("allows disabling critique mode without checking isPublic", async () => {
		dbMock.update.mockReturnValueOnce(updateChain([{ critiqueEnabled: false }]));

		const result = await resumeCritiqueService.setEnabled({
			id: "resume-1",
			userId: "owner-1",
			critiqueEnabled: false,
		});
		expect(result).toEqual({ critiqueEnabled: false });
		expect(dbMock.select).not.toHaveBeenCalled();
	});
});

describe("verify", () => {
	it("throws NOT_FOUND when no eligible (public + critique-enabled + passworded) resume matches", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([]));

		await expect(
			resumeCritiqueService.verify({
				username: "jane",
				slug: "resume",
				password: "secret",
				requestHeaders: new Headers(),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws INVALID_PASSWORD when the password does not match", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([eligibleResumeRow]));
		compareMock.mockResolvedValueOnce(false);

		await expect(
			resumeCritiqueService.verify({
				username: "jane",
				slug: "resume",
				password: "wrong",
				requestHeaders: new Headers(),
			}),
		).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
	});

	it("requires a display name for a first-time critiquer", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([eligibleResumeRow]));
		compareMock.mockResolvedValueOnce(true);
		readCritiquerIdFromCookieMock.mockReturnValueOnce(null);

		await expect(
			resumeCritiqueService.verify({
				username: "jane",
				slug: "resume",
				password: "secret",
				requestHeaders: new Headers(),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(dbMock.insert).not.toHaveBeenCalled();
	});

	it("creates a new critiquer and grants a cookie when no valid identity cookie is present", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([eligibleResumeRow]));
		compareMock.mockResolvedValueOnce(true);
		readCritiquerIdFromCookieMock.mockReturnValueOnce(null);
		dbMock.insert.mockReturnValueOnce(insertChain([{ id: "critiquer-new", displayName: "Jane Coach" }]));
		const responseHeaders = new Headers();

		const result = await resumeCritiqueService.verify({
			username: "jane",
			slug: "resume",
			password: "secret",
			displayName: "Jane Coach",
			requestHeaders: new Headers(),
			responseHeaders,
		});

		expect(result).toEqual({ critiquerId: "critiquer-new", displayName: "Jane Coach" });
		expect(grantCritiquerCookieMock).toHaveBeenCalledWith(
			responseHeaders,
			"resume-1",
			"critiquer-new",
			"hashed-password",
		);
	});

	it("recognizes a returning critiquer from the cookie and ignores the submitted display name", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([eligibleResumeRow]));
		compareMock.mockResolvedValueOnce(true);
		readCritiquerIdFromCookieMock.mockReturnValueOnce("critiquer-existing");
		dbMock.update.mockReturnValueOnce(updateChain([{ id: "critiquer-existing", displayName: "Jane Coach" }]));

		const result = await resumeCritiqueService.verify({
			username: "jane",
			slug: "resume",
			password: "secret",
			displayName: "Someone Else Entirely",
			requestHeaders: new Headers(),
		});

		expect(result).toEqual({ critiquerId: "critiquer-existing", displayName: "Jane Coach" });
		expect(dbMock.insert).not.toHaveBeenCalled();
	});
});

describe("getCritiqueView", () => {
	it("throws NEED_PASSWORD when there is no valid critiquer cookie", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([eligibleResumeRow]));
		readCritiquerIdFromCookieMock.mockReturnValueOnce(null);

		await expect(
			resumeCritiqueService.getCritiqueView({ username: "jane", slug: "resume", requestHeaders: new Headers() }),
		).rejects.toMatchObject({ code: "NEED_PASSWORD", data: { username: "jane", slug: "resume" } });
	});

	it("throws NEED_PASSWORD when the cookie's critiquer id no longer exists for this resume", async () => {
		dbMock.select.mockReturnValueOnce(selectJoinChain([eligibleResumeRow]));
		readCritiquerIdFromCookieMock.mockReturnValueOnce("stale-critiquer");
		dbMock.select.mockReturnValueOnce(selectChain([])); // requireCritiquerId's existence check

		await expect(
			resumeCritiqueService.getCritiqueView({ username: "jane", slug: "resume", requestHeaders: new Headers() }),
		).rejects.toMatchObject({ code: "NEED_PASSWORD" });
	});

	it("returns only the calling critiquer's own comments", async () => {
		dbMock.select
			.mockReturnValueOnce(selectJoinChain([eligibleResumeRow])) // getCritiqueEligibleResume
			.mockReturnValueOnce(selectChain([{ id: "critiquer-1" }])) // requireCritiquerId existence check
			.mockReturnValueOnce(selectChain([{ displayName: "Jane Coach" }])) // critiquer displayName lookup
			.mockReturnValueOnce(selectChain([{ id: "comment-1", body: "Fix typo" }])); // own comments
		readCritiquerIdFromCookieMock.mockReturnValueOnce("critiquer-1");

		const result = await resumeCritiqueService.getCritiqueView({
			username: "jane",
			slug: "resume",
			requestHeaders: new Headers(),
		});

		expect(result.critiquerId).toBe("critiquer-1");
		expect(result.displayName).toBe("Jane Coach");
		expect(result.comments).toEqual([{ id: "comment-1", body: "Fix typo" }]);
	});
});

describe("updateOwnComment / deleteOwnComment", () => {
	beforeEach(() => {
		dbMock.select
			.mockReturnValueOnce(selectJoinChain([eligibleResumeRow])) // getCritiqueEligibleResume
			.mockReturnValueOnce(selectChain([{ id: "critiquer-1" }])); // requireCritiquerId existence check
		readCritiquerIdFromCookieMock.mockReturnValueOnce("critiquer-1");
	});

	it("updateOwnComment throws NOT_FOUND when the comment isn't this critiquer's own pending comment", async () => {
		dbMock.update.mockReturnValueOnce(updateChain([]));

		await expect(
			resumeCritiqueService.updateOwnComment({
				username: "jane",
				slug: "resume",
				requestHeaders: new Headers(),
				commentId: "someone-elses-comment",
				body: "edited",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("deleteOwnComment throws NOT_FOUND when the comment isn't this critiquer's own pending comment", async () => {
		dbMock.delete.mockReturnValueOnce(deleteChain([]));

		await expect(
			resumeCritiqueService.deleteOwnComment({
				username: "jane",
				slug: "resume",
				requestHeaders: new Headers(),
				commentId: "someone-elses-comment",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("listAllComments / updateCommentStatus", () => {
	it("updateCommentStatus throws NOT_FOUND when the comment doesn't belong to a resume this user owns", async () => {
		dbMock.update.mockReturnValueOnce(updateChain([]));

		await expect(
			resumeCritiqueService.updateCommentStatus({
				resumeId: "resume-1",
				userId: "not-the-owner",
				commentId: "comment-1",
				status: "resolved",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
