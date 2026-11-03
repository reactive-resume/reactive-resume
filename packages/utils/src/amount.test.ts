import { expect, it } from "vite-plus/test";
import { getCurrencyOptions, parseAmount, parseDecimal } from "./amount";

it("labels currency choices with codes and localized symbols without dropping saved codes", () => {
	const english = getCurrencyOptions("en-US", "BTC");
	expect(english.find((option) => option.value === "USD")?.label).toBe("USD · $");
	expect(english.find((option) => option.value === "EUR")?.label).toBe("EUR · €");
	expect(english.find((option) => option.value === "BTC")?.label).toBe("BTC");
	expect(getCurrencyOptions("de-DE").find((option) => option.value === "USD")?.label).toBe("USD · $");
	expect(getCurrencyOptions("ar-SA").find((option) => option.value === "EUR")?.label).toContain("EUR");
	expect(new Set(english.map((option) => option.value)).size).toBe(english.length);
	expect(getCurrencyOptions("en-US", "bad input").some((option) => option.value === "bad input")).toBe(false);
});

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
	expect(parseDecimal(`0.${"0".repeat(323)}1`, "en-US")).toBeUndefined();
	expect(parseDecimal(`0.${"0".repeat(323)}5`, "en-US")).toBe(Number.MIN_VALUE);
});
