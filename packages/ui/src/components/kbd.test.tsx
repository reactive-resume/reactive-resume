import { describe, expect, it } from "vite-plus/test";
import { ariaShortcut, formatShortcut } from "./kbd";

describe("formatShortcut", () => {
	it("keeps Mac glyphs on Apple devices", () => {
		expect(formatShortcut("⇧⌘Z", true)).toBe("⇧⌘Z");
	});

	it("names the keys elsewhere", () => {
		expect(formatShortcut("⌘K", false)).toBe("Ctrl+K");
		expect(formatShortcut("⇧⌘Z", false)).toBe("Ctrl+Shift+Z");
		expect(formatShortcut("⌥↑", false)).toBe("Alt+↑");
		expect(formatShortcut("N", false)).toBe("N");
	});
});

describe("ariaShortcut", () => {
	it("names the keys that actually work on each platform", () => {
		expect(ariaShortcut("⌘K", true)).toBe("Meta+K");
		expect(ariaShortcut("⌘K", false)).toBe("Control+K");
		expect(ariaShortcut("⇧⌘Z", false)).toBe("Shift+Control+Z");
	});
});
