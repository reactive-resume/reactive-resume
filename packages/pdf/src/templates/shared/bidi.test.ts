import { describe, expect, it } from "vite-plus/test";
import { createElement } from "react";
import { paragraphDirection } from "./bidi";

describe("paragraphDirection", () => {
	it("follows the first letter", () => {
		expect(paragraphDirection("Led a team of 5.")).toBe("ltr");
		expect(paragraphDirection(createElement("span", null, "قاد فريقًا"))).toBe("rtl");
		expect(paragraphDirection("2024 – 2026")).toBe("rtl");
	});
});
