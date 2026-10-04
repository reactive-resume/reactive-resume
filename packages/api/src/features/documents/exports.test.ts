import { beforeEach, expect, it, vi } from "vitest";
import { call } from "@orpc/server";
import { unzipSync, strFromU8 } from "fflate";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const getResume = vi.hoisted(() => vi.fn());
vi.mock("../resume/service", () => ({ resumeService: { getById: getResume } }));
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
