import { Buffer } from "node:buffer";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { zipSync } from "fflate";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const generateTextMock = vi.hoisted(() => vi.fn());
const envMock = vi.hoisted(() => ({
	FLAG_ALLOW_UNSAFE_AI_BASE_URL: false,
}));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));
vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return { ...actual, generateText: generateTextMock };
});

afterEach(() => {
	generateTextMock.mockReset();
});

const u16 = (value: number) => {
	const buffer = Buffer.alloc(2);
	buffer.writeUInt16LE(value);
	return buffer;
};

const u32 = (value: number) => {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value);
	return buffer;
};

function createDocxBase64(text: string): string {
	const name = Buffer.from("word/document.xml");
	const data = Buffer.from(
		`<?xml version="1.0" encoding="UTF-8"?><w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
	);
	const compressed = deflateRawSync(data);
	const local = Buffer.concat([
		u32(0x04034b50),
		u16(20),
		u16(0),
		u16(8),
		u16(0),
		u16(0),
		u32(0),
		u32(compressed.length),
		u32(data.length),
		u16(name.length),
		u16(0),
		name,
		compressed,
	]);
	const central = Buffer.concat([
		u32(0x02014b50),
		u16(20),
		u16(20),
		u16(0),
		u16(8),
		u16(0),
		u16(0),
		u32(0),
		u32(compressed.length),
		u32(data.length),
		u16(name.length),
		u16(0),
		u16(0),
		u16(0),
		u16(0),
		u32(0),
		u32(0),
		name,
	]);
	const eocd = Buffer.concat([
		u32(0x06054b50),
		u16(0),
		u16(0),
		u16(1),
		u16(1),
		u32(central.length),
		u32(local.length),
		u16(0),
	]);

	return Buffer.concat([local, central, eocd]).toString("base64");
}

const { aiService, extractDocxTextFromBytes } = await import("./service");

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const part = (root: string, ...texts: string[]) =>
	new TextEncoder().encode(`<?xml version="1.0"?><w:${root}>${texts.map(paragraph).join("")}</w:${root}>`);

describe("AI DOCX parsing", () => {
	it("sends DOCX content as extracted text instead of an unsupported file part", async () => {
		generateTextMock.mockResolvedValue({ text: JSON.stringify(defaultResumeData) });

		await aiService.parseDocx({
			provider: "openai-compatible",
			model: "test-model",
			apiKey: "test-key",
			baseURL: "https://example.test/v1",
			mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			file: { name: "resume.docx", data: createDocxBase64("Jane Doe &amp; Co") },
		});

		const request = generateTextMock.mock.calls[0]?.[0] as { messages: unknown[] };
		const messages = JSON.stringify(request.messages);

		expect(messages).toContain("Jane Doe & Co");
		expect(messages).toContain("converted to plain text");
		expect(messages).not.toContain('"type":"file"');
	});
});

describe("extractDocxTextFromBytes", () => {
	it("reads the page header and footer around the body, each repeated header once", () => {
		const docx = zipSync({
			"word/document.xml": part("document", "Experience", "Designer at Lumen"),
			"word/header1.xml": part("hdr", "Priya Raman", "priya@example.com · Berlin"),
			"word/header2.xml": part("hdr", "Priya Raman", "priya@example.com · Berlin"),
			"word/footer1.xml": part("ftr", "linkedin.com/in/priya"),
		});
		expect(extractDocxTextFromBytes(docx)).toBe(
			"Priya Raman\npriya@example.com · Berlin\n\nExperience\nDesigner at Lumen\n\nlinkedin.com/in/priya",
		);
	});

	it("still refuses a file with no text anywhere", () => {
		expect(() => extractDocxTextFromBytes(zipSync({ "word/document.xml": part("document") }))).toThrow(
			"DOCX document content is empty.",
		);
	});
});
