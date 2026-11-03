import { expect, it } from "vite-plus/test";
import { parseAmount, parseDecimal } from "./amount";

it("keeps monetary precision and safe bounds while accepting finite percentage decimals", () => {
	for (const [locale, text, value] of [
		["en-US", "12,345.67", 12345.67],
		["de-DE", "12.345,67", 12345.67],
		["ar-SA", "١٢٬٣٤٥٫٦٧", 12345.67],
	] as const) {
		expect(parseAmount(text, locale)).toBe(value);
	}
	for (const text of ["12.345", "9007199254740992", "1,23", "95k", "-1", "Infinity", "1e3", "12."]) {
		expect(parseAmount(text, "en-US"), text).toBeUndefined();
	}
	expect(parseAmount("", "en-US")).toBeNull();
	expect(parseAmount("0", "en-US")).toBe(0);
	expect(parseDecimal("12,345", "de-DE")).toBe(12.345);
	expect(parseDecimal("١٢٫٣٤٥", "ar-SA")).toBe(12.345);
	for (const text of ["-1", "Infinity", "1e3", "1,23", "12."])
		expect(parseDecimal(text, "en-US"), text).toBeUndefined();
	expect(parseDecimal("9".repeat(400), "en-US")).toBeUndefined();
});
