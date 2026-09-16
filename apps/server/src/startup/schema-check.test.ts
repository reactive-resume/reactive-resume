import { describe, expect, it } from "vitest";
import { collectExpectedColumns, verifyMigratedSchema } from "./schema-check";

describe("collectExpectedColumns", () => {
	it("collects every column of every schema table", () => {
		const expected = collectExpectedColumns();
		expect(expected.length).toBeGreaterThan(0);
		expect(expected).toContainEqual({ tableName: "ai_providers", columnName: "user_id" });
		expect(expected).toContainEqual({ tableName: "user", columnName: "id" });
	});
});

describe("verifyMigratedSchema", () => {
	it("passes when the catalog reports nothing missing", async () => {
		const queryable = { query: async () => ({ rows: [] }) };
		await expect(verifyMigratedSchema(queryable)).resolves.toBeUndefined();
	});

	it("fails with the table name when every column of a table is missing", async () => {
		const rows = collectExpectedColumns()
			.filter((e) => e.tableName === "ai_providers")
			.map((e) => ({ table_name: e.tableName, column_name: e.columnName }));

		const queryable = { query: async () => ({ rows }) };
		await expect(verifyMigratedSchema(queryable)).rejects.toThrow('table "ai_providers"');
	});

	it("fails with the qualified column name when only some columns are missing", async () => {
		const queryable = { query: async () => ({ rows: [{ table_name: "user", column_name: "role" }] }) };
		await expect(verifyMigratedSchema(queryable)).rejects.toThrow('"user"."role"');
	});

	it("passes the expected table and column lists to the catalog query", async () => {
		let captured: unknown[] | undefined;
		const queryable = {
			query: (_text: string, values?: unknown[]) => {
				captured = values;
				return Promise.resolve({ rows: [] });
			},
		};

		await verifyMigratedSchema(queryable);

		const [tables, columns] = captured as [string[], string[]];
		// The query relies on $1/$2 being index-aligned, so each table name must pair
		// with its own column name at the same index.
		const pairs = tables.map((table, index) => `${table}.${columns[index]}`);
		expect(pairs).toContain("ai_providers.user_id");
	});
});
