import { describe, expect, it } from "vite-plus/test";
import { wordDiff } from "./word-diff";

const join = (segments: ReturnType<typeof wordDiff>, kinds: string[]) =>
	(segments ?? [])
		.filter((segment) => kinds.includes(segment.kind))
		.map((segment) => segment.text)
		.join("");

describe("wordDiff", () => {
	it("marks only the changed words of a small fix", () => {
		const segments = wordDiff("Led a team of five designers.", "Led a team of six designers.");
		expect(segments).toEqual([
			{ kind: "same", text: "Led a team of " },
			{ kind: "removed", text: "five " },
			{ kind: "added", text: "six " },
			{ kind: "same", text: "designers." },
		]);
	});

	it("reads back as each text", () => {
		const before = "Ran usability tests every sprint\nwith customers";
		const after = "Ran moderated usability tests every sprint\nwith 12 customers";
		const segments = wordDiff(before, after);
		expect(join(segments, ["same", "removed"]).trim()).toBe(before.trim());
		expect(join(segments, ["same", "added"])).toBe(after);
	});

	it("gives up on a rewrite", () => {
		expect(wordDiff("Managed the budget.", "Shipped three products to new markets in Europe.")).toBeNull();
		expect(wordDiff("", "Something")).toBeNull();
	});
});
