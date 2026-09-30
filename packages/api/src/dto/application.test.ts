import { describe, expect, it } from "vitest";
import { applicationDto } from "./application";

describe("applicationDto sourceUrl", () => {
	it("rejects URLs that would be unsafe in anchors", () => {
		expect(() =>
			applicationDto.create.input.parse({
				company: "Stripe",
				role: "Engineer",
				sourceUrl: "javascript:alert(1)",
			}),
		).toThrow("URL must use http or https.");
	});
});

describe("applicationDto contacts", () => {
	it("keeps legacy contacts compatible", () => {
		const parsed = applicationDto.create.input.parse({
			company: "Stripe",
			role: "Engineer",
			contacts: [{ name: "Jane Doe" }],
		});

		expect(parsed.contacts?.[0]).toMatchObject({ email: "", phone: "" });
	});
});

describe("applicationDto zero-argument inputs", () => {
	it("normalizes stats input to an empty object", () => {
		expect(applicationDto.stats.input.parse(undefined)).toEqual({});
	});
});

describe("applicationDto document files", () => {
	it.each(["create", "update"] as const)(
		"%s accepts PDFs and rejects wrong MIME types and oversized files",
		(operation) => {
			const input = { id: "app-1", company: "Stripe", role: "Engineer" };
			const pdf = new File(["%PDF"], "resume.pdf", { type: "application/pdf" });
			expect(applicationDto[operation].input.parse({ ...input, resumeFile: pdf, coverLetterFile: pdf })).toMatchObject({
				resumeFile: pdf,
				coverLetterFile: pdf,
			});
			for (const file of [
				new File(["text"], "resume.txt", { type: "text/plain" }),
				new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }),
			]) {
				expect(() => applicationDto[operation].input.parse({ ...input, resumeFile: file })).toThrow();
				expect(() => applicationDto[operation].input.parse({ ...input, coverLetterFile: file })).toThrow();
			}
		},
	);
});
