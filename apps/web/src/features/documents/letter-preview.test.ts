import { describe, expect, it } from "vite-plus/test";
import { letterBodyLines, letterGreeting } from "./letter-preview";

describe("letterBodyLines", () => {
	it("keeps the opening lines, turning paragraphs and line breaks into separate lines", () => {
		expect(
			letterBodyLines(
				"<p>I am writing about the staff engineer role.</p><p>Your work on the widget platform caught my eye.</p><p>A third paragraph.</p><p>A fourth that the thumbnail leaves out.</p>",
			),
		).toEqual([
			"I am writing about the staff engineer role.",
			"Your work on the widget platform caught my eye.",
			"A third paragraph.",
		]);
	});

	it("reads plain text and drops blank lines", () => {
		expect(letterBodyLines("First line\n\nSecond line\nThird line")).toEqual([
			"First line",
			"Second line",
			"Third line",
		]);
	});

	it("decodes entities the stored letter HTML carries", () => {
		expect(letterBodyLines("<p>R&amp;D &amp; design&nbsp;team</p>")).toEqual(["R&D & design team"]);
		expect(letterBodyLines("<p>&lt;hello&gt; &#39;world&#39;</p>")).toEqual(["<hello> 'world'"]);
	});

	it("returns nothing for a letter with no body", () => {
		expect(letterBodyLines("")).toEqual([]);
		expect(letterBodyLines(null)).toEqual([]);
		expect(letterBodyLines(undefined)).toEqual([]);
	});
});

it("treats only a custom greeting as preview content", () => {
	expect(letterGreeting("  Dear Dana,  ")).toBe("Dear Dana,");
	expect(letterGreeting("   ")).toBeNull();
	expect(letterGreeting(null)).toBeNull();
	expect(letterGreeting(undefined)).toBeNull();
});
