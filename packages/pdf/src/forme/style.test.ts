import { describe, expect, it } from "vite-plus/test";
import { flattenAlpha, parseColor, toColor, toFormeStyle, WHITE } from "./style";

const convert = (style: Record<string, unknown>) =>
	toFormeStyle(style as never, { fontSize: 10, pageWidth: 600, pageHeight: 800 });

describe("toFormeStyle", () => {
	it("keeps unitless line heights as multipliers and turns lengths into one", () => {
		expect(convert({ lineHeight: 1.4 }).style.lineHeight).toBe(1.4);
		expect(convert({ lineHeight: "150%" }).style.lineHeight).toBe(1.5);
		expect(convert({ fontSize: 12, lineHeight: "18pt" }).style.lineHeight).toBe(1.5);
	});

	it("converts lengths to points and keeps percentages only for box sizes", () => {
		expect(convert({ width: "1in", marginTop: "2em", left: "50%" }).style).toEqual({
			width: 72,
			marginTop: 20,
			left: "50%",
		});
		expect(convert({ paddingTop: "10%" }).dropped).toEqual(["paddingTop"]);
	});

	it("names the standard serif the way Forme does", () => {
		expect(convert({ fontFamily: ["Times-Roman", "Noto Serif"] }).style.fontFamily).toBe("Times, Noto Serif");
	});
});

describe("colours", () => {
	it.each([
		'rgb(0,0,0)"><script>test()</script>)',
		"rgb(a,b,c)",
		"rgb(1,2,3",
		"rgb(1,2,Infinity)",
		`rgb(1,2,3${" ".repeat(10000)}!)`,
	])("rejects malformed or oversized colour %s", (value) => {
		expect(toColor(value)).toBeUndefined();
		expect(parseColor(value)).toBeUndefined();
	});

	it("normalises the forms Forme reads", () => {
		expect(toColor("#abcd")).toBe("#aabbccdd");
		expect(toColor("rgb(10 20 30 / 50%)")).toBe("rgba(10, 20, 30, 0.5)");
		expect(toColor("rgb(100%, 0%, 0%)")).toBe("rgb(255, 0, 0)");
		expect(toColor("transparent")).toBe("rgba(0, 0, 0, 0)");
		expect(parseColor("#ff000080")).toEqual({ rgb: [255, 0, 0], alpha: 128 / 255 });
	});

	it("mixes translucent colours with what they're drawn over", () => {
		const { style, backdrop } = flattenAlpha(
			{ backgroundColor: "rgba(0, 0, 255, 0.5)", color: "rgba(0, 0, 0, 0.5)" },
			WHITE,
		);
		expect(style.backgroundColor).toBe("#8080ff");
		// Text is drawn over its own background.
		expect(style.color).toBe("#404080");
		expect(backdrop).toEqual([127.5, 127.5, 255]);
	});

	it("drops fully transparent paint and keeps opaque paint as it is", () => {
		expect(flattenAlpha({ backgroundColor: "rgba(0, 0, 0, 0)", color: "#123456" }, WHITE).style).toEqual({
			color: "#123456",
		});
	});
});
