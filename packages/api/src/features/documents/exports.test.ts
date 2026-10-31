import { beforeEach, expect, it, vi } from "vite-plus/test";
import { call } from "@orpc/server";
import { unzipSync, strFromU8 } from "fflate";
import { copyCoverLetterStyle, createCoverLetterResumeData } from "@reactive-resume/resume/cover-letter";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const getResume = vi.hoisted(() => vi.fn());
const getLetter = vi.hoisted(() => vi.fn());
vi.mock("../resume/service", () => ({ resumeService: { getById: getResume } }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: { getById: getLetter } }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner" } }) } },
	verifyOAuthToken: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "owner", banned: false }] }) }) }) },
}));
const { documentExports } = await import("./exports");
const context = { locale: "en-US" as const, reqHeaders: new Headers() };
beforeEach(() => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.summary.content = "<p>Builds analytical engines.</p>";
	getResume.mockResolvedValue({ id: "resume-1", name: "Ada", data });
});

it("exports saved data as round-trippable JSON, readable Markdown and a Word document", async () => {
	const json = await call(documentExports.resume, { id: "resume-1", format: "json" }, { context });
	expect(JSON.parse(await json.body.text())).toMatchObject({ basics: { name: "Ada Lovelace" } });
	expect(json.headers["content-disposition"]).toContain(".json");
	const markdown = await call(documentExports.resume, { id: "resume-1", format: "md" }, { context });
	expect(await markdown.body.text()).toContain("Builds analytical engines.");
	const docx = await call(documentExports.resume, { id: "resume-1", format: "docx" }, { context });
	const files = unzipSync(new Uint8Array(await docx.body.arrayBuffer()));
	const xml = files["word/document.xml"];
	expect(xml).toBeDefined();
	if (!xml) throw new Error("Missing Word document");
	expect(strFromU8(xml)).toContain("Ada Lovelace");
	expect(getResume).toHaveBeenCalledWith({ id: "resume-1", userId: "owner" });
});

it("keeps editor list markers in the Word export used by API and native clients", async () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.summary.content = "<p>Plain paragraph</p><ul><li><p>Editor bullet</p></li><li>Plain bullet</li></ul>";
	getResume.mockResolvedValue({ id: "resume-1", name: "Ada", data });
	const docx = await call(documentExports.resume, { id: "resume-1", format: "docx" }, { context });
	const files = unzipSync(new Uint8Array(await docx.body.arrayBuffer()));
	const documentXml = files["word/document.xml"];
	const numberingXml = files["word/numbering.xml"];
	if (!documentXml || !numberingXml) throw new Error("Missing Word list definitions");
	const xml = strFromU8(documentXml);
	const plainParagraph = xml
		.match(/<w:p[ >][\s\S]*?<\/w:p>/g)
		?.find((paragraph) => paragraph.includes("Plain paragraph"));
	expect(plainParagraph).toContain("Plain paragraph");
	expect(plainParagraph).not.toContain("<w:numPr>");
	expect(plainParagraph).not.toContain("ListParagraph");
	expect(xml.match(/<w:numPr>/g)).toHaveLength(2);
	expect(xml).toContain("Editor bullet");
	expect(xml).toContain("Plain bullet");
	expect(strFromU8(numberingXml)).toContain('<w:numFmt w:val="bullet"/>');
});

it("exports an editable OpenDocument Text file", async () => {
	const odt = await call(documentExports.resume, { id: "resume-1", format: "odt" }, { context });
	expect(odt.headers["content-disposition"]).toContain(".odt");
	const files = unzipSync(new Uint8Array(await odt.body.arrayBuffer()));
	expect(strFromU8(files.mimetype ?? new Uint8Array())).toBe("application/vnd.oasis.opendocument.text");
	const content = files["content.xml"];
	expect(content).toBeDefined();
	if (!content) throw new Error("Missing OpenDocument content");
	const xml = strFromU8(content);
	expect(xml).toContain("Ada Lovelace");
	expect(xml).toContain("Builds analytical engines.");
});

function letterFixture(senderLinked = false) {
	const data = structuredClone(defaultResumeData);
	Object.assign(data.basics, {
		name: "Ada Lovelace",
		headline: "Analytical Engineer",
		email: "ada@example.com",
		phone: "+44 1234 567890",
		location: "London",
		website: { url: "https://example.com", label: "Portfolio" },
		customFields: [{ id: "social", icon: "link", text: "Ada on GitHub", link: "https://github.com/example" }],
	});
	return coverLetterSchema.parse({
		id: "letter-1",
		name: "Engine letter",
		recipient: "",
		content: "<p>I build analytical engines.</p>",
		layout: "structured",
		recipientName: "Dana Reyes",
		recipientCompany: "Engine Company",
		letterDate: "2026-10-29",
		style: copyCoverLetterStyle(data),
		senderLinked,
		designLinked: false,
		sourceResumeId: senderLinked ? "resume-1" : null,
		sourceApplicationId: null,
		isLocked: false,
		revision: 1,
		createdAt: new Date(0),
		updatedAt: new Date(0),
	});
}

async function documentText(blob: Blob, format: "docx" | "odt") {
	const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
	const xml = files[format === "docx" ? "word/document.xml" : "content.xml"];
	if (!xml) throw new Error("Missing document content");
	return strFromU8(xml).replace(/<[^>]+>/g, "");
}

it.each(["docx", "odt"] as const)(
	"preserves standalone sender and letter content in %s for API/native exports",
	async (format) => {
		// getById returns resolved style for linked senders and stored style for copied senders.
		for (const senderLinked of [true, false]) {
			for (const template of ["onyx", "chikorita", "gengar"] as const) {
				const letter = letterFixture(senderLinked);
				letter.style.metadata.template = template;
				getLetter.mockResolvedValue(letter);
				const response = await call(documentExports.letter, { id: letter.id, format }, { context });
				const text = await documentText(response.body, format);
				for (const value of [
					"ada@example.com",
					"Analytical Engineer",
					"+44 1234 567890",
					"London",
					"Portfolio",
					"Ada on GitHub",
				]) {
					expect(text.split(value)).toHaveLength(2);
				}
				expect(text.split("Ada Lovelace")).toHaveLength(3); // Header and automatic signature.
				expect(text).toContain(
					"Dana ReyesEngine CompanyOctober 29, 2026Dear Dana,I build analytical engines.Kind regards,Ada Lovelace",
				);
				expect(text).not.toContain("Engine letter"); // No cover-letter section heading.
			}
		}
		expect(getLetter).toHaveBeenCalledWith({ id: "letter-1", userId: "owner" });
	},
);

it.each(["docx", "odt"] as const)("keeps absent sender fields absent in standalone %s", async (format) => {
	const letter = letterFixture();
	letter.style.basics = structuredClone(defaultResumeData.basics);
	letter.style.basics.name = "Ada Lovelace";
	getLetter.mockResolvedValue(letter);
	const response = await call(documentExports.letter, { id: letter.id, format }, { context });
	const text = await documentText(response.body, format);
	expect(text.startsWith("Ada LovelaceDana Reyes")).toBe(true);
	expect(text).toContain("I build analytical engines.");
	for (const value of [
		"ada@example.com",
		"Analytical Engineer",
		"+44 1234 567890",
		"London",
		"Portfolio",
		"Ada on GitHub",
	]) {
		expect(text).not.toContain(value);
	}
});

it.each(["docx", "odt"] as const)("retains header omission for legacy embedded-only %s exports", async (format) => {
	const data = createCoverLetterResumeData(letterFixture());
	const blob =
		format === "docx"
			? await (await import("@reactive-resume/docx")).buildDocx(data)
			: await (await import("@reactive-resume/odt")).buildOdt(data);
	const text = await documentText(blob, format);
	expect(text).toBe("I build analytical engines.");
});
