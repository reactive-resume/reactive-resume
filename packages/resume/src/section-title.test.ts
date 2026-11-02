import { describe, expect, it } from "vite-plus/test";
import { nextFreeSectionTitle } from "./section-title";

describe("nextFreeSectionTitle", () => {
	it("keeps a title nobody uses", () => {
		expect(nextFreeSectionTitle("Projects", ["Experience"])).toBe("Projects");
	});

	it("numbers a title already shown, skipping numbers in use", () => {
		expect(nextFreeSectionTitle("Projects", ["projects "])).toBe("Projects 2");
		expect(nextFreeSectionTitle("Projects", ["Projects", "Projects 2"])).toBe("Projects 3");
	});
});
