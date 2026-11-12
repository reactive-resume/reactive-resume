import { describe, expect, it } from "vite-plus/test";
import { describeError } from "./error-log";

const secret = "private-value@example.test";

describe("describeError", () => {
	it("logs frames of an ordinary error and none of its message", () => {
		const described = describeError(new TypeError(`Failed query: select 1\nparams: ${secret}`));
		expect(described).toMatchObject({ code: "INTERNAL_SERVER_ERROR", errorName: "TypeError" });
		const stack = (described as { stack?: string[] }).stack ?? [];
		expect(stack.length).toBeGreaterThan(0);
		for (const frame of stack) expect(frame).toMatch(/^at .*:\d+:\d+\)?$/);
		expect(JSON.stringify(described)).not.toContain(secret);
	});

	it("does not take a line of the message for a frame, even when the message changed after the stack was made", () => {
		const error = new Error(`first line\nat ${secret} leaked\n    at ${secret} indented`);
		// Reading the stack fixes its text; the message inside it no longer matches the current one.
		expect(error.stack).toContain(secret);
		error.message = "replaced";
		const described = describeError(error);
		expect(JSON.stringify(described)).not.toContain(secret);
		expect((described as { stack?: string[] }).stack?.length ?? 0).toBeGreaterThan(0);
	});

	it("keeps the frame shapes V8 prints", () => {
		const error = new Error("x");
		error.stack = [
			"Error: x",
			"    at handler (file:///app/apps/server/dist/index.mjs:1234:17)",
			"    at /srv/app/src/rpc/handler.ts:15:12",
			"    at async Promise.all (index 0)",
			"    at new Foo (node:internal/modules/cjs/loader:1554:14)",
			"    at Object.<anonymous> (index.js:12:3)",
			"    at not a frame at all",
		].join("\n");
		expect((describeError(error) as { stack?: string[] }).stack).toEqual([
			"at handler (file:///app/apps/server/dist/index.mjs:1234:17)",
			"at /srv/app/src/rpc/handler.ts:15:12",
			"at async Promise.all (index 0)",
			"at new Foo (node:internal/modules/cjs/loader:1554:14)",
			"at Object.<anonymous> (index.js:12:3)",
		]);
	});
});
