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

it.each(["///", " \t ", "\u202e"])("uses the slug when the document name sanitizes to nothing: %j", (name) => {
	const source = { name, slug: "jordan-resume", data: { basics: { name: "" } } };
	expect(getDefaultFileName(source)).toBe("jordan-resume");
	expect(getDefaultFileName(source, "cover-letter")).toBe("jordan-resume-Cover-Letter");
});

it("removes traversal, separators, control characters and header punctuation", () => {
	expect(sanitizeFileName("../../etc/passwd")).toBe("etcpasswd");
	expect(sanitizeFileName("..\\..\\windows\\evil")).toBe("windowsevil");
	expect(sanitizeFileName("a\r\nb\u0000c")).toBe("abc");
	expect(sanitizeFileName('a"b<c>d:e|f?g*h')).toBe("abcdefgh");
	expect(sanitizeFileName("\u202e李明-Resume.pdf")).toBe("李明-Resume.pdf");
});

it("names the file in the resume's own language", () => {
	const data = (locale: string) => ({ basics: { name: "Layla Haddad" }, metadata: { page: { locale } } });
	expect(getDefaultFileName({ name: "", data: data("de-DE") })).toBe("Layla-Haddad-Lebenslauf");
	expect(getDefaultFileName({ name: "", data: data("de-DE") }, "cover-letter")).toBe("Layla-Haddad-Anschreiben");
	expect(getDefaultFileName({ name: "", data: data("en-US") })).toBe("Layla-Haddad-Resume");
	// A locale without a translation keeps the English word.
	expect(getDefaultFileName({ name: "", data: data("xx-XX") })).toBe("Layla-Haddad-Resume");
});
