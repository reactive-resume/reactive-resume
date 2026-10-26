import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const dbMock = vi.hoisted(() => ({ insert: vi.fn(), delete: vi.fn(), select: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));

const { checkSlug, findFreeSlug, matchesSlug, recordSlugChange } = await import("./slugs");

beforeEach(() => {
	for (const mock of Object.values(dbMock)) mock.mockReset();
	dbMock.select.mockReturnValue({ from: () => ({ where: vi.fn().mockResolvedValue([]) }) });
});

describe("recordSlugChange", () => {
	it("frees the new address from old redirects and keeps the old one for 30 days", async () => {
		const deleteWhere = vi.fn(async () => undefined);
		dbMock.delete.mockReturnValue({ where: deleteWhere });
		const onConflictDoUpdate = vi.fn(async () => undefined);
		const values = vi.fn((_input: { expiresAt: Date }) => ({ onConflictDoUpdate }));
		dbMock.insert.mockReturnValue({ values });

		await recordSlugChange(dbMock as never, { userId: "u1", resumeId: "r1", from: "old", to: "new" });

		expect(deleteWhere).toHaveBeenCalled();
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", resumeId: "r1", slug: "old" }));
		const expiresIn = (values.mock.calls[0]?.[0].expiresAt.getTime() ?? 0) - Date.now();
		expect(Math.round(expiresIn / (24 * 60 * 60 * 1000))).toBe(30);
		expect(onConflictDoUpdate).toHaveBeenCalled();
	});
});

describe("matchesSlug", () => {
	it("builds condition checking resume slug or unexpired redirect subquery", async () => {
		const { PgDialect } = await import("drizzle-orm/pg-core");
		const { drizzle } = await import("drizzle-orm/node-postgres");
		const testDb = drizzle({ client: {} as never });
		dbMock.select.mockImplementation((fields?: unknown) => testDb.select(fields as never));

		const condition = matchesSlug("old-slug");
		if (!condition) throw new Error("Expected condition");
		const query = new PgDialect().sqlToQuery(condition);

		expect(query.sql).toContain('"resume"."slug" = $1');
		expect(query.sql).toContain('"resume_slug_redirect"."slug" = $2');
		expect(query.sql).toContain('"resume_slug_redirect"."user_id" = "resume"."user_id"');
		expect(query.sql).toContain('"resume_slug_redirect"."expires_at" > now()');
		expect(query.params).toEqual(["old-slug", "old-slug"]);
	});
});

describe("findFreeSlug", () => {
	it("truncates long names so generated slug never exceeds 64 characters even with suffix", async () => {
		const longName = "Very Long Resume Name ".repeat(5);
		const baseStem = "very-long-resume-name-very-long-resume-name-very-long-re";
		const selectWhere = vi.fn().mockResolvedValue([{ slug: baseStem }]);
		dbMock.select.mockReturnValue({ from: () => ({ where: selectWhere }) });

		const slug = await findFreeSlug(dbMock as never, "u1", longName);

		expect(slug).toBe(`${baseStem}-2`);
		expect(slug.length).toBeLessThanOrEqual(64);
		expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});
});

describe("checkSlug", () => {
	it("truncates invalid slug suggestion to 64 characters without trailing dash", async () => {
		const input = "ä".repeat(50);
		const result = await checkSlug({ userId: "u1", resumeId: "r1", slug: input });

		expect(result.status).toBe("invalid");
		expect(result.suggestion).toBeDefined();
		expect(result.suggestion?.length).toBeLessThanOrEqual(64);
		expect(result.suggestion).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});

	it("treats slug longer than 64 characters as invalid and suggests truncated version", async () => {
		const longSlug = "a".repeat(70);
		const result = await checkSlug({ userId: "u1", resumeId: "r1", slug: longSlug });

		expect(result.status).toBe("invalid");
		expect(result.suggestion).toBe("a".repeat(64));
	});

	it("checks availability of truncated candidate and suggests a free slug if candidate is taken", async () => {
		const longSlug = "a".repeat(70);
		const baseStem = "a".repeat(56);
		let queryCount = 0;
		const selectWhere = vi.fn().mockImplementation(() => {
			queryCount++;
			if (queryCount === 1) return Promise.resolve([]);
			if (queryCount === 2) return Promise.resolve([{ id: "r2" }]);
			return Promise.resolve([{ slug: baseStem }]);
		});
		dbMock.select.mockReturnValue({ from: () => ({ where: selectWhere }) });

		const result = await checkSlug({ userId: "u1", resumeId: "r1", slug: longSlug });

		expect(result.status).toBe("invalid");
		expect(result.suggestion).toBe(`${baseStem}-2`);
	});

	it("returns current for an existing unchanged slug belonging to the resume even if longer than 64 characters", async () => {
		const longSlug = "a".repeat(70);
		const selectWhere = vi.fn().mockResolvedValue([{ id: "r1", name: "My Resume" }]);
		dbMock.select.mockReturnValue({ from: () => ({ where: selectWhere }) });

		const result = await checkSlug({ userId: "u1", resumeId: "r1", slug: longSlug });
		expect(result).toEqual({ status: "current" });
	});

	it("returns available when no other resume uses the slug", async () => {
		const selectWhere = vi.fn().mockResolvedValue([]);
		dbMock.select.mockReturnValue({ from: () => ({ where: selectWhere }) });

		const result = await checkSlug({ userId: "u1", resumeId: "r1", slug: "valid-slug" });
		expect(result).toEqual({ status: "available" });
	});
});
