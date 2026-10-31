import { expect, it } from "vite-plus/test";
import { contentDisposition } from "./http";

const utf8Name = (header: string) => {
	const encoded = header.match(/filename\*=UTF-8''([^;]+)$/)?.[1];
	if (!encoded) throw new Error(`Missing filename*: ${header}`);
	return decodeURIComponent(encoded);
};

it("keeps an ASCII file name in the RFC filename alone", () => {
	expect(contentDisposition("Jordan-Long-Resume.pdf")).toBe('attachment; filename="Jordan-Long-Resume.pdf"');
});

it.each(["李明-Resume.pdf", "आदा-कुमार-Resume.pdf", "أحمد-علي-Resume.pdf", "José-Álvarez-Resume.pdf"])(
	"carries the full Unicode name in filename*: %s",
	(filename) => {
		const header = contentDisposition(filename);
		expect(utf8Name(header)).toBe(filename);
		expect(header).toContain('filename="');
		expect(new Response(null, { headers: { "Content-Disposition": header } }).headers.get("Content-Disposition")).toBe(
			header,
		);
	},
);

it("folds Latin accents into the legacy fallback and leaves other scripts out", () => {
	expect(contentDisposition("José-Álvarez-Resume.pdf")).toContain('filename="Jose-Alvarez-Resume.pdf"');
	expect(contentDisposition("李明-Resume.pdf")).toContain('filename="Resume.pdf"');
	expect(contentDisposition("李明.pdf")).toContain('filename="document.pdf"');
});

it("cannot inject a header or escape the download folder", () => {
	const header = contentDisposition('../../etc/passwd"\r\nX-Injected: yes\r\n\r\n李明-Resume.pdf');
	const response = new Response(null, { headers: { "Content-Disposition": header } });

	expect(header).not.toMatch(/[\r\n]/);
	expect(header).not.toContain("..");
	expect(header).not.toContain("/");
	expect(response.headers.get("X-Injected")).toBeNull();
	expect(response.headers.get("Content-Disposition")).toBe(header);
	expect(utf8Name(header)).toContain("李明-Resume.pdf");
});

it("supports an inline preview without changing the file name", () => {
	expect(contentDisposition("李明-Resume.pdf", "inline")).toMatch(/^inline; filename="Resume.pdf"; filename\*=UTF-8''/);
});

it.each([
	{ character: "李", extension: ".pdf", kept: 83 },
	{ character: "😀", extension: ".json", kept: 62 },
	{ character: "a", extension: ".docx", kept: 250 },
])(
	"bounds long $character names without splitting characters or losing $extension",
	({ character, extension, kept }) => {
		const header = contentDisposition(`${character.repeat(2000)}${extension}`);
		const filename = header.includes("filename*=") ? utf8Name(header) : header.match(/filename="([^"]+)"/)?.[1];

		expect(filename).toBe(`${character.repeat(kept)}${extension}`);
		expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(255);
		expect(header.length).toBeLessThan(1200);
		expect(new Response(null, { headers: { "Content-Disposition": header } }).headers.get("Content-Disposition")).toBe(
			header,
		);
	},
);
