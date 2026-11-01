import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vite-plus/test";
import { call } from "@orpc/server";
import { createResumePdfFile } from "@reactive-resume/pdf/server";
const create = vi.hoisted(() => vi.fn());
vi.mock("./service", () => ({ resumeService: { create } }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: "owner" } }) } },
	verifyOAuthToken: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: () => ({
			from: () => ({
				// Auth selects one owner; import naming awaits the query for existing resume names.
				where: () => Object.assign(Promise.resolve([]), { limit: async () => [{ id: "owner", banned: false }] }),
			}),
		}),
	},
}));
const { importResumeFile } = await import("./imports");

import { pdfImportCases, pdfImportSource, pdfExperienceFields } from "./fixtures/pdf-import";
import shipped from "./fixtures/shipped-import.json";
const save = async (file: File) => {
	create.mockClear();
	await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
	expect(create).toHaveBeenCalledTimes(1);
	const saved = create.mock.calls[0]?.[0] as { data: ResumeData } | undefined;
	if (!saved) throw new Error("Import must create a resume");
	return saved.data;
};
it.each(shipped)("preserves complete shipped identity and work history / $template", async (c) => {
	const data = await save(
		new File(
			[readFileSync(new URL(`../../../../../apps/web/public/templates/pdf/${c.template}.pdf`, import.meta.url))],
			`${c.template}.pdf`,
		),
	);
	expect(data.basics).toEqual(c.basics);
	expect(pdfExperienceFields(data.sections.experience.items)).toEqual(c.experience);
	expect(data.customSections.filter((section) => section.title !== "Community")).toEqual([]);
});
it.each(pdfImportCases)(
	"preserves whole identity, record fields and rich wording / $template / $kind / $period / $index",
	async (c) => {
		const source = pdfImportSource(c);
		const file = await createResumePdfFile({ data: source, template: c.template, filename: "regression.pdf" });
		const data = await save(file);
		const expectedBasics = { ...source.basics };
		if (c.template === "persian") expectedBasics.name = "JORDAN SAMPLE";
		if (c.template === "smeargle") expectedBasics.headline = "P R O D U C T & P L A T F O R M L E A D";
		expect(data.basics).toEqual(expectedBasics);
		expect(pdfExperienceFields(data.sections.experience.items)).toEqual(
			pdfExperienceFields(source.sections.experience.items),
		);
		expect(data.sections.experience.items.map((item) => item.dates)).toEqual(
			source.sections.experience.items.map((item) => item.dates),
		);
		expect(data.customSections).toEqual([]);
	},
	60000,
);
it("keeps a wrapped rail contact as identity and preserves every displayed name character", async () => {
	const data = await save(new File([readFileSync(new URL("./fixtures/glalie-rail.pdf", import.meta.url))], "rail.pdf"));
	expect(data.basics).toEqual({
		name: "Fiction al Review er",
		headline: "",
		email: "reviewer@example.invalid",
		phone: "",
		location: "",
		website: { url: "", label: "" },
		customFields: [],
	});
	expect(data.customSections).toEqual([]);
	expect(data.sections.experience.items).toHaveLength(4);
});
