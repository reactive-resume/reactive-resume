import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { PARITY_TOOL_META } from "./parity";
import { TOOL_META } from "./tool-meta";

describe("tool annotations", () => {
	it("keeps reviewer justifications aligned with every registered tool", () => {
		const review = readFileSync(new URL("./fixtures/tool-annotations.md", import.meta.url), "utf8");
		const rows = new Map(
			[
				...review.matchAll(
					/^\| `([^`]+)` +\| (true|false) +\| (true|false) +\| (true|false) +\| (true|false) +\| (.+?) +\|$/gm,
				),
			].map(
				([, name, readOnly, destructive, idempotent, openWorld, reason]) =>
					[
						name,
						{
							annotations: {
								readOnlyHint: readOnly === "true",
								destructiveHint: destructive === "true",
								idempotentHint: idempotent === "true",
								openWorldHint: openWorld === "true",
							},
							reason,
						},
					] as const,
			),
		);
		const tools = { ...TOOL_META, ...PARITY_TOOL_META };
		expect([...rows.keys()].sort()).toEqual(Object.keys(tools).sort());
		for (const [name, tool] of Object.entries(tools)) {
			const row = rows.get(name);
			expect(tool.annotations, name).toMatchObject(row?.annotations ?? {});
			expect(row?.reason?.length, name).toBeGreaterThan(40);
		}
	});
});
