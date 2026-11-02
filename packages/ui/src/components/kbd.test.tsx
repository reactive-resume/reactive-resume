import { describe, expect, it } from "vite-plus/test";
import { formatShortcut } from "./kbd";

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
