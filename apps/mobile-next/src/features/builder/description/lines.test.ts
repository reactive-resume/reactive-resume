import { parseLines, serializeLines, toggleWrap } from "./lines";

test("lines round-trip lists, paragraphs and marks", () => {
	const html = "<p>Intro</p><ul><li>Led <strong>it</strong></li><li>Ran 40+</li></ul>";
	const lines = parseLines(html);
	expect(lines.map((l) => [l.text, l.list])).toEqual([
		["Intro", false],
		["Led it", true],
		["Ran 40+", true],
	]);
	expect(serializeLines(lines)).toBe(html);
	expect(toggleWrap({ text: "Ran 40+", list: true }, "em")).toBe("<em>Ran 40+</em>");
	expect(toggleWrap({ text: "x", list: false, html: "<em>x</em>" }, "em")).toBe("x");
});
