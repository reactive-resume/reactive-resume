import { expect, it } from "vite-plus/test";
import { getDefaultFileName, sanitizeFileName } from "./file";

it.each([
	["Jordan Long", "Jordan-Long-Resume"],
	["李明", "李明-Resume"],
	["आदा कुमार", "आदा-कुमार-Resume"],
	["أحمد علي", "أحمد-علي-Resume"],
	["José Álvarez", "José-Álvarez-Resume"],
])("names a resume from its full name: %s", (name, filename) => {
	expect(getDefaultFileName({ name: "acme-tailored-v3", slug: "acme", data: { basics: { name } } })).toBe(filename);
});

it("names a cover letter from its sender and keeps the document name as the fallback", () => {
	expect(
		getDefaultFileName({ name: "acme-tailored-v3", slug: "acme", data: { basics: { name: "李明" } } }, "cover-letter"),
	).toBe("李明-Cover-Letter");
	expect(getDefaultFileName({ name: "Long resume", slug: "long", data: { basics: { name: "" } } })).toBe("Long-resume");
});

it("removes traversal, separators, control characters and header punctuation", () => {
	expect(sanitizeFileName("../../etc/passwd")).toBe("etcpasswd");
	expect(sanitizeFileName("..\\..\\windows\\evil")).toBe("windowsevil");
	expect(sanitizeFileName("a\r\nb\u0000c")).toBe("abc");
	expect(sanitizeFileName('a"b<c>d:e|f?g*h')).toBe("abcdefgh");
	expect(sanitizeFileName("\u202e李明-Resume.pdf")).toBe("李明-Resume.pdf");
});
