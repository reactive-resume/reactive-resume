import { describe, expect, it } from "vite-plus/test";
import { BULLET_PATTERN, toHtmlBlocks } from "./html";

describe("plain-text HTML blocks", () => {
	it("preserves paragraphs around a single bullet and escapes source markup", () => {
		expect(toHtmlBlocks(["Intro.", "•Built <systems> that 25% more users can use.", "Conclusion."])).toBe(
			"<p>Intro.</p><ul><li>Built &lt;systems&gt; that 25% more users can use.</li></ul><p>Conclusion.</p>",
		);
	});
	it("does not attach lowercase or digit-led prose to a preceding bullet", () => {
		expect(toHtmlBlocks(["•Built tools", "references available on request", "3 offices worldwide"])).toBe(
			"<ul><li>Built tools</li></ul><p>references available on request</p><p>3 offices worldwide</p>",
		);
	});
	it.each(["•Built it", "◦Built it", "‣Built it", "·Built it", "- Built it", "* Built it"])(
		"recognizes marker in %s",
		(text) => {
			expect(text.replace(BULLET_PATTERN, "")).toBe("Built it");
		},
	);
	it("does not mistake punctuation inside a word for a bullet", () => {
		expect(toHtmlBlocks(["-based systems", "*pointer", "—word"])).toBe(
			"<p>-based systems</p><p>*pointer</p><p>—word</p>",
		);
	});
});
