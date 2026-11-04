import { describe, expect, it } from "vite-plus/test";
import { collectExpectedColumns, verifyMigratedSchema } from "./schema-check";

describe("verifyMigratedSchema", () => {
	it("fails with the table name when every column of a table is missing", async () => {
		const rows = collectExpectedColumns()
			.filter((e) => e.tableName === "ai_providers")
			.map((e) => ({ table_name: e.tableName, column_name: e.columnName }));

		const queryable = { query: async () => ({ rows }) };
		await expect(verifyMigratedSchema(queryable)).rejects.toThrow('table "ai_providers"');
	});
});
