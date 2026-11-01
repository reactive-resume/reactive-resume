import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const source = transformSync(readFileSync(new URL("../src/features/workspace/share.ts", import.meta.url), "utf8"), {
	loader: "ts",
	format: "cjs",
}).code;

test("workspace packet sharing stays account-bound through availability and file writing", async () => {
	for (const change of ["availability", "write", null]) {
		let scope = "account-A";
		let writes = 0;
		let shares = 0;
		let deletes = 0;
		const module = { exports: {} };
		const dependencies = {
			"@/auth/session": { getAccountScope: () => scope },
			"expo-file-system": {
				Paths: { cache: { list: () => [] } },
				File: class {
					write() {
						writes++;
						if (change === "write") scope = "account-B";
					}
					delete() {
						deletes++;
					}
				},
			},
			"expo-sharing": {
				isAvailableAsync: async () => {
					if (change === "availability") scope = "account-B";
					return true;
				},
				shareAsync: async () => {
					shares++;
				},
			},
		};
		new Function("require", "module", "exports", source)(
			(name) => {
				assert.ok(name in dependencies, `Unexpected native boundary: ${name}`);
				return dependencies[name];
			},
			module,
			module.exports,
		);
		await module.exports.shareText(
			"application-packet.json",
			"PRIVATE REVIEWED PACKET",
			"application/json",
			"public.json",
		);
		assert.equal(writes, change === "availability" ? 0 : 1, "changed account must not write a private packet");
		assert.equal(shares, change === null ? 1 : 0, "changed account must not open the share sheet");
		assert.equal(deletes, change === "write" ? 1 : 0, "late write must be removed");
	}
});
