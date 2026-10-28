import { describe, expect, it } from "vite-plus/test";
import { contrastOnWhite, isDarkColor, parseColorString, rgbaStringToHex } from "./color";

describe("rgbaStringToHex", () => {
	it("converts opaque rgba to hex (alpha not represented)", () => {
		expect(rgbaStringToHex("rgba(0, 255, 0, 1)")).toBe("#00ff00");
	});

	it("preserves 6-digit hex colors", () => {
		expect(rgbaStringToHex("#F1F5F9")).toBe("#f1f5f9");
		expect(rgbaStringToHex("#0F172A")).toBe("#0f172a");
	});

	it("returns black for formats neither parser nor @uiw understands", () => {
		expect(rgbaStringToHex("not-a-color")).toBe("#000000");
	});
});

describe("isDarkColor", () => {
	it("classifies opaque dark colors as dark", () => {
		expect(isDarkColor("rgba(0, 0, 0, 1)")).toBe(true);
	});

	it("composites transparent colors over white before checking darkness", () => {
		expect(isDarkColor("rgba(0, 0, 0, 0.1)")).toBe(false);
	});
});

describe("parseColorString", () => {
	it("rejects oversized colour values before parsing or falling back", () => {
		const value = `rgb(1,2,3${" ".repeat(100000)}!)`;
		expect(parseColorString(value)).toBeNull();
		expect(rgbaStringToHex(value)).toBe("#000000");
	});

	describe("rgb format", () => {
		it("parses rgb without alpha as alpha=1", () => {
			expect(parseColorString("rgb(255, 128, 64)")).toEqual({ r: 255, g: 128, b: 64, a: 1 });
		});

		it("parses rgba with alpha, including alpha=0", () => {
			expect(parseColorString("rgba(10, 20, 30, 0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
			expect(parseColorString("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
		});

		it("returns null for malformed rgb", () => {
			expect(parseColorString("rgb(255, 0)")).toBeNull();
			expect(parseColorString("rgb(a, b, c)")).toBeNull();
		});
	});

	describe("hex format", () => {
		it("parses 6-digit hex", () => {
			expect(parseColorString("#ff8040")).toEqual({ r: 255, g: 128, b: 64, a: 1 });
		});

		it("parses 3-digit hex by doubling each digit", () => {
			expect(parseColorString("#f80")).toEqual({ r: 0xff, g: 0x88, b: 0x00, a: 1 });
		});
	});
});

describe("contrastOnWhite", () => {
	it("measures WCAG contrast against white", () => {
		expect(contrastOnWhite("rgba(0, 0, 0, 1)")).toBeCloseTo(21, 0);
		expect(contrastOnWhite("#ffffff")).toBeCloseTo(1, 5);
		// The sample template blue, just short of 4.5:1 for body text.
		expect(contrastOnWhite("rgba(0, 132, 209, 1)")).toBeCloseTo(4.02, 1);
	});

	it("lays transparency over white, and treats unreadable colours as no contrast", () => {
		expect(contrastOnWhite("rgba(0, 0, 0, 0)")).toBeCloseTo(1, 5);
		expect(contrastOnWhite("hsl(0 0% 0%)")).toBe(1);
	});
});
