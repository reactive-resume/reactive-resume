import { describe, expect, it } from "vite-plus/test";
import { serializeStylesheetColor, toStylesheetPickerColor } from "./color-format";

describe("stylesheet picker color formatting", () => {
	it.each(["#e7000b", "#155dfc00", "#abcdef01", "#abcdeffe"])(
		"retains every color and alpha byte when reopening %s",
		(value) => expect(serializeStylesheetColor(toStylesheetPickerColor(value))).toBe(value),
	);
});
