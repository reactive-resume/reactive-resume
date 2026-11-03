import { expect, it } from "vite-plus/test";
import { replyPlaceholders } from "./reply";

it("reports complete outer placeholders, deduplicates and preserves localized text", () => {
	expect(replyPlaceholders("Available [date [timezone]] or [Zeitfenster]. Again [date [timezone]].")).toEqual([
		"[date [timezone]]",
		"[Zeitfenster]",
	]);
	expect(replyPlaceholders("[incomplete\n[valid] [] plain")).toEqual(["[valid]"]);
});
