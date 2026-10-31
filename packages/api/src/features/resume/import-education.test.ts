import type { ResumeData } from "@reactive-resume/schema/resume/data";
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
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "owner", banned: false }] }) }) }) },
}));
const { importResumeFile } = await import("./imports");

import { educationCases, educationSource, educationFields, educationWords } from "./fixtures/pdf-education";
const save = async (file: File) => {
	create.mockClear();
	await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
	expect(create).toHaveBeenCalledTimes(1);
	const saved = create.mock.calls[0]?.[0] as { data: ResumeData } | undefined;
	if (!saved) throw Error("No imported data");
	return saved.data;
};

it.each(educationCases)(
	"preserves whole mixed-date Education records / $template / $kind",
	async (c) => {
		const source = educationSource(c);
		const file = await createResumePdfFile({ data: source, template: c.template, filename: "education.pdf" });
		const data = await save(file);
		expect(educationFields(data.sections.education.items)).toEqual(educationFields(source.sections.education.items));
		const actual = new Set(educationWords(data.sections.education.items));
		expect(educationWords(source.sections.education.items).filter((word) => !actual.has(word))).toEqual([]);
		expect(data.customSections).toEqual([]);
	},
	60000,
);
