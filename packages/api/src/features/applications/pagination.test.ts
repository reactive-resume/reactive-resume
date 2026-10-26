import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { getTableColumns } from "drizzle-orm";
import { application } from "@reactive-resume/db/schema";

const fixture = vi.hoisted(() => ({
	query: vi.fn<(config: { text: string }, params: unknown[]) => Promise<{ rows: unknown[][] }>>(),
	rows: [] as unknown[][],
	total: 0,
}));

vi.mock("@reactive-resume/db/client", async () => {
	const { drizzle } = await import("drizzle-orm/node-postgres");
	return { db: drizzle({ client: { query: fixture.query } as unknown as Pool }) };
});
vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string }; resHeaders: Headers }>() };
});
vi.mock("../resume/service", () => ({ resumeService: {} }));
vi.mock("../resume/version-history", () => ({ writeVersion: vi.fn() }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));
vi.mock("../cover-letters/versions", () => ({ writeLetterVersion: vi.fn() }));
vi.mock("../storage/service", () => ({ getStorageService: vi.fn(), uploadFile: vi.fn() }));

const { crudRouter } = await import("./crud");

function row(id: string) {
	const values: Record<string, unknown> = {
		id,
		userId: "owner",
		company: "Example",
		role: "Engineer",
		status: "closed",
		tags: ["engineering"],
		requirements: [],
		contacts: [],
		activity: [
			{ id: "older", type: "note", text: "Applied", at: "2026-07-01T12:00:00.000Z" },
			{ id: "newer", type: "note", text: "Closed", at: "2026-07-02T12:00:00.000Z" },
		],
		appliedAt: "2026-07-01T12:00:00.000Z",
		createdAt: "2026-07-01T12:00:00.000Z",
		updatedAt: "2026-07-02T12:00:00.000Z",
	};
	return Object.keys(getTableColumns(application)).map((key) => values[key] ?? null);
}

function client() {
	const resHeaders = new Headers();
	return {
		resHeaders,
		api: createRouterClient(crudRouter, {
			context: { user: { id: "owner" }, resHeaders } as never,
		}),
	};
}

function queries() {
	return fixture.query.mock.calls.map(([config, params]) => ({
		sql: config.text,
		params,
	}));
}

beforeEach(() => {
	fixture.rows = [row("page-item")];
	fixture.total = 42;
	fixture.query.mockReset();
	fixture.query.mockImplementation(async ({ text }: { text: string }) => ({
		rows: text.includes("count(") ? [[fixture.total]] : fixture.rows,
	}));
});

describe("application list pagination", () => {
	it("returns the database page without slicing it again and preserves total headers", async () => {
		const { api, resHeaders } = client();
		const items = await api.list({ status: "closed", tags: ["engineering"], limit: 1, offset: 20 });

		expect(items.map((item) => item.id)).toEqual(["page-item"]);
		expect(items[0]).not.toHaveProperty("userId");
		expect(items[0]?.activity.map((entry) => entry.id)).toEqual(["newer", "older"]);
		expect(resHeaders.get("X-Total-Count")).toBe("42");
		expect(resHeaders.get("X-Limit")).toBe("1");
		expect(resHeaders.get("X-Offset")).toBe("20");

		const statements = queries();
		const page = statements.find((query) => !query.sql.includes("count("));
		const total = statements.find((query) => query.sql.includes("count("));
		expect(page?.sql).toContain("limit $4 offset $5");
		expect(page?.params).toEqual(["owner", "closed", ["engineering"], 1, 20]);
		expect(total?.params).toEqual(["owner", "closed", ["engineering"]]);
		expect(page?.sql.split(" where ")[1]?.split(" order by ")[0]).toBe(total?.sql.split(" where ")[1]);
	});

	it.each([
		{ input: { limit: 3 }, limit: 3, offset: 0 },
		{ input: { offset: 4 }, limit: 20, offset: 4 },
	])("preserves pagination defaults for $input", async ({ input, limit, offset }) => {
		const { api, resHeaders } = client();
		await api.list(input);
		const page = queries().find((query) => !query.sql.includes("count("));
		expect(page?.params).toEqual(offset === 0 ? ["owner", limit] : ["owner", limit, offset]);
		expect(resHeaders.get("X-Limit")).toBe(String(limit));
		expect(resHeaders.get("X-Offset")).toBe(String(offset));
	});

	it.each([undefined, {}])("keeps the complete list when pagination is omitted: %s", async (input) => {
		fixture.rows = [row("first"), row("second")];
		const { api, resHeaders } = client();
		const items = await api.list(input);

		expect(items.map((item) => item.id)).toEqual(["first", "second"]);
		expect(resHeaders.get("X-Total-Count")).toBe("2");
		expect(resHeaders.has("X-Limit")).toBe(false);
		expect(resHeaders.has("X-Offset")).toBe(false);
		expect(queries()).toHaveLength(1);
		expect(queries()[0]?.sql).not.toContain("limit");
		expect(queries()[0]?.params).toEqual(["owner"]);
	});

	it("keeps the filtered total when the requested page is empty", async () => {
		fixture.rows = [];
		const { api, resHeaders } = client();
		expect(await api.list({ limit: 20, offset: 100 })).toEqual([]);
		expect(resHeaders.get("X-Total-Count")).toBe("42");
	});

	it("returns an empty library with a zero total", async () => {
		fixture.rows = [];
		fixture.total = 0;
		const { api, resHeaders } = client();
		expect(await api.list({ limit: 20 })).toEqual([]);
		expect(resHeaders.get("X-Total-Count")).toBe("0");
	});

	it.each([{}, { limit: 20 }])("uses indexed ordering with a unique tie-breaker: %s", async (input) => {
		const { api } = client();
		await api.list(input);
		const page = queries().find((query) => !query.sql.includes("count("));
		expect(page?.sql).toContain('order by "application"."updated_at" desc nulls last, "application"."id" desc');
	});

	it("rejects invalid pagination before querying", async () => {
		const { api } = client();
		await expect(api.list({ limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(fixture.query).not.toHaveBeenCalled();
	});
});
