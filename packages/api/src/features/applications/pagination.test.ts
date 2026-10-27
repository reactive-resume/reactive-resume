import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { getTableColumns } from "drizzle-orm";
import { application } from "@reactive-resume/db/schema";

const fixture = vi.hoisted(() => ({
	query: vi.fn<(config: { text: string }, params: unknown[]) => Promise<{ rows: unknown[][] }>>(),
	rows: [] as unknown[][],
	fullRows: [] as unknown[][],
	fullRowsActive: false,
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
		jobDescription: "full description",
		notes: "private note",
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

function summaryRow(id: string) {
	return [
		id,
		"owner",
		"Example",
		"Engineer",
		null,
		null,
		"closed",
		"not-selected",
		null,
		null,
		"referral",
		["engineering"],
		"https://example.com/job",
		88,
		null,
		null,
		[],
		[
			{ id: "stage", type: "stage", stage: "applied", at: "2026-07-01T12:00:00.000Z" },
			{
				id: "interview",
				type: "interview",
				kind: "technical",
				durationMinutes: 60,
				location: "Remote",
				notes: "Bring examples",
				participants: [],
				audience: "practitioner",
				timezone: "UTC",
				at: "2026-07-02T12:00:00.000Z",
			},
		],
		"2026-07-01T12:00:00.000Z",
		"2026-07-01T12:00:00.000Z",
		"2026-07-02T12:00:00.000Z",
	];
}

function candidateSummary(id: string, status: string, updatedAt: string) {
	const value = summaryRow(id);
	value[6] = status;
	value[7] = null;
	value[20] = updatedAt;
	return value;
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
	fixture.fullRows = fixture.rows;
	fixture.fullRowsActive = false;
	fixture.total = 42;
	fixture.query.mockReset();
	fixture.query.mockImplementation(async ({ text }: { text: string }, params) => ({
		rows: text.includes("count(")
			? [[fixture.total]]
			: text.includes("jsonb_path_query_array")
				? fixture.rows
				: fixture.fullRowsActive
					? fixture.fullRows.filter((values) => params.includes(values[0]))
					: fixture.rows,
	}));
});

describe("application list summary", () => {
	it("projects a lightweight row and keeps stage/interview activity", async () => {
		fixture.rows = [summaryRow("summary-item")];
		const { api, resHeaders } = client();
		const items = await api.listSummary({ status: "closed", tags: ["engineering"], limit: 1, offset: 2 });

		expect(items.map((item) => item.id)).toEqual(["summary-item"]);
		expect(items[0]).not.toHaveProperty("jobDescription");
		expect(items[0]).not.toHaveProperty("notes");
		expect(items[0]).not.toHaveProperty("requirements");
		expect(items[0]?.activity.map((entry) => entry.id)).toEqual(["interview", "stage"]);
		expect(resHeaders.get("X-Total-Count")).toBe("42");
		expect(resHeaders.get("X-Limit")).toBe("1");
		expect(resHeaders.get("X-Offset")).toBe("2");

		const page = queries().find((query) => !query.sql.includes("count("));
		expect(page?.sql).toContain("jsonb_path_query_array");
		expect(page?.sql).not.toContain('"job_description"');
		expect(page?.sql).not.toContain('"notes"');
		expect(page?.params).toEqual(["owner", "closed", ["engineering"], 1, 2]);
	});
});

describe("application list summary completeness", () => {
	it("returns complete filtered totals when pagination is omitted", async () => {
		fixture.rows = [summaryRow("first"), summaryRow("second")];
		const { api, resHeaders } = client();
		const items = await api.listSummary({});

		expect(items.map((item) => item.id)).toEqual(["first", "second"]);
		expect(resHeaders.get("X-Total-Count")).toBe("2");
		expect(resHeaders.has("X-Limit")).toBe(false);
		expect(resHeaders.has("X-Offset")).toBe(false);
		expect(queries()).toHaveLength(1);
		expect(queries()[0]?.sql).not.toContain("limit");
		expect(queries()[0]?.params).toEqual(["owner"]);
	});

	it("keeps the total when a requested page is empty", async () => {
		fixture.rows = [];
		const { api, resHeaders } = client();
		expect(await api.listSummary({ limit: 20, offset: 100 })).toEqual([]);
		expect(resHeaders.get("X-Total-Count")).toBe("42");
		expect(resHeaders.get("X-Limit")).toBe("20");
		expect(resHeaders.get("X-Offset")).toBe("100");
	});

	it("attaches a bounded set of full rows in default list order", async () => {
		const candidate = summaryRow("initial-item");
		candidate[6] = "interview";
		candidate[7] = null;
		fixture.rows = [candidate];
		fixture.fullRows = [row("initial-item")];
		fixture.fullRowsActive = true;
		const { api } = client();
		const items = await api.listSummary({ includeInitialDetails: 1 });

		expect(items[0]?.initialDetail?.id).toBe("initial-item");
		expect(items[0]?.initialDetail?.jobDescription).toBe("full description");
		expect(items[0]).not.toHaveProperty("jobDescription");
		expect(queries()).toHaveLength(2);
		expect(queries()[1]?.sql).toContain(" in ");
	});

	it("attaches the web/mobile candidate union with one batch query", async () => {
		const updatedAt = "2026-07-03T12:00:00.000Z";
		const summaryRows = [
			candidateSummary("interview-d", "interview", updatedAt),
			candidateSummary("interview-c", "interview", updatedAt),
			candidateSummary("interview-b", "interview", updatedAt),
			candidateSummary("interview-a", "interview", updatedAt),
			candidateSummary("offer-a", "offer", updatedAt),
			candidateSummary("closed-a", "closed", updatedAt),
		];
		fixture.rows = summaryRows;
		fixture.fullRows = summaryRows.map(([id]) => row(String(id)));
		fixture.fullRowsActive = true;
		const { api } = client();
		const items = await api.listSummary({ includeInitialDetails: 3 });

		expect(items.map((item) => item.id)).toEqual(summaryRows.map(([id]) => id));
		const attached = items
			.filter((item) => item.initialDetail)
			.map((item) => item.id)
			.sort();
		expect(attached).toEqual(["interview-a", "interview-b", "interview-c", "interview-d"]);
		expect(items.find((item) => item.id === "closed-a")).not.toHaveProperty("initialDetail");
		expect(items.every((item) => item.initialDetail?.id === item.id || !item.initialDetail)).toBe(true);
		expect(queries()).toHaveLength(2);
		expect(queries()[1]?.sql).toMatch(/ in /);
		expect(queries()[1]?.params).toContain("owner");
	});

	it.each([
		{
			name: "a later timestamp group in one stage",
			rows: [
				["interview-new", "interview", "2026-07-04T00:00:00Z"],
				["interview-c", "interview", "2026-07-03T00:00:00Z"],
				["interview-b", "interview", "2026-07-03T00:00:00Z"],
				["interview-a", "interview", "2026-07-03T00:00:00Z"],
				["offer-a", "offer", "2026-07-02T00:00:00Z"],
			],
			expected: ["interview-a", "interview-b", "interview-c", "interview-new"],
		},
		{
			name: "a cutoff in the next stage",
			rows: [
				["offer-c", "offer", "2026-07-04T00:00:00Z"],
				["offer-b", "offer", "2026-07-04T00:00:00Z"],
				["offer-a", "offer", "2026-07-04T00:00:00Z"],
				["interview-a", "interview", "2026-07-03T00:00:00Z"],
				["saved-a", "saved", "2026-07-02T00:00:00Z"],
			],
			expected: ["interview-a", "offer-a", "offer-b", "offer-c"],
		},
	] as const)("preloads both clients' first rows across $name", async ({ rows, expected }) => {
		fixture.rows = rows.map(([id, status, at]) => candidateSummary(id, status, at));
		fixture.fullRows = rows.map(([id]) => row(id));
		fixture.fullRowsActive = true;
		const { api } = client();
		const items = await api.listSummary({ includeInitialDetails: 3 });
		expect(
			items
				.filter((item) => item.initialDetail)
				.map((item) => item.id)
				.sort(),
		).toEqual(expected);
		expect(queries()[1]?.params).toHaveLength(expected.length + 1);
		expect(queries()[1]?.params).toEqual(expect.arrayContaining(["owner", ...expected]));
		expect(queries()).toHaveLength(2);
	});

	it("can preload closed rows when the caller explicitly filters for them", async () => {
		fixture.rows = [summaryRow("closed-a")];
		fixture.fullRows = [row("closed-a")];
		fixture.fullRowsActive = true;
		const { api } = client();
		const items = await api.listSummary({ status: "closed", includeInitialDetails: 1 });
		expect(items[0]?.initialDetail?.id).toBe("closed-a");
	});

	it("keeps summary response unchanged when initial details are omitted or zero", async () => {
		fixture.rows = [summaryRow("summary-item")];
		const { api } = client();
		const omitted = await api.listSummary({});
		expect(omitted[0]).not.toHaveProperty("initialDetail");
		expect(queries()).toHaveLength(1);

		fixture.query.mockReset();
		fixture.query.mockImplementation(async ({ text }: { text: string }) => ({
			rows: text.includes("count(") ? [[fixture.total]] : fixture.rows,
		}));
		const zero = await api.listSummary({ includeInitialDetails: 0 });
		expect(zero[0]).not.toHaveProperty("initialDetail");
		expect(queries()).toHaveLength(1);
	});

	it("rejects more than six initial details before querying", async () => {
		const { api } = client();
		await expect(api.listSummary({ includeInitialDetails: 7 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(fixture.query).not.toHaveBeenCalled();
	});
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
		expect(items[0]?.jobDescription).toBe("full description");
		expect(items[0]?.notes).toBe("private note");
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
