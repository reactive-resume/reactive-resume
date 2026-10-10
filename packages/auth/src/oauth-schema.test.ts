import { describe, expect, it } from "vitest";
import { oauthProvider } from "@better-auth/oauth-provider";
import { getColumns, is, Table } from "drizzle-orm";
import * as dbSchema from "@reactive-resume/db/schema";

const plugin = oauthProvider({ loginPage: "/login", consentPage: "/consent" });

describe("OAuth provider persistence schema", () => {
	it.each(Object.entries(plugin.schema))("provides every installed plugin field for %s", (modelName, model) => {
		const table = Reflect.get(dbSchema, modelName);
		expect(is(table, Table), `Missing table ${modelName}`).toBe(true);
		if (!is(table, Table)) return;
		const columns = getColumns(table);
		for (const field of Object.keys(model.fields)) {
			expect(columns, `${modelName}.${field}`).toHaveProperty(field);
		}
	});
});
