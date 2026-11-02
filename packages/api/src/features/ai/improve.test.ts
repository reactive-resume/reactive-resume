import { describe, expect, it } from "vite-plus/test";
import { buildUserPrompt, improveInputSchema, improveOutputSchema } from "./improve";

describe("improve", () => {
	it("flattens the line and treats an unclear addsFacts as needing a check", () => {
		expect(improveOutputSchema.parse({ text: " Launched\nthe app ", why: "Ownership.", addsFacts: "maybe" })).toEqual({
			text: "Launched the app",
			why: "Ownership.",
			addsFacts: true,
		});
		expect(() => improveOutputSchema.parse({ text: "  " })).toThrow();
	});

	it("sends the result the user gave for Add a result, and asks for one without it", () => {
		const base = { line: "Ran usability tests every sprint.", action: "result" } as const;
		expect(buildUserPrompt(improveInputSchema.parse({ ...base, request: "Cut support tickets by 20%" }))).toContain(
			"Request: Add a result. The user says the result was: Cut support tickets by 20%",
		);
		expect(buildUserPrompt(improveInputSchema.parse(base))).toContain("Request: Add a result\n");
	});
});
