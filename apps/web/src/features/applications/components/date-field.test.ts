import { expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { formatFieldValue } from "./date-field";

i18n.load("en", {});
i18n.activate("en");

it("reads a field value in words, with today named only when asked", () => {
	const today = new Date(2026, 10, 7, 9);
	expect(formatFieldValue("date", "2026-11-10", "en-GB")).toBe("Tue 10 Nov 2026");
	expect(formatFieldValue("date", "2026-11-07", "en-GB", today)).toBe("Today, 7 Nov");
	expect(formatFieldValue("date", "2026-11-07", "en-GB")).toBe("Sat 7 Nov 2026");
	expect(formatFieldValue("time", "09:00", "en-GB")).toBe("09:00");
	expect(formatFieldValue("date", "", "en-GB")).toBe("");
});
