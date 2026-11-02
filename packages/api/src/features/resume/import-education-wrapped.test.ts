import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { expect, it, vi } from "vite-plus/test";
import { call } from "@orpc/server";
import { createResumePdfFile } from "@reactive-resume/pdf/server";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { generateId } from "@reactive-resume/utils/string";
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
				where: () => Object.assign(Promise.resolve([]), { limit: async () => [{ id: "owner", banned: false }] }),
			}),
		}),
	},
}));
const { importResumeFile } = await import("./imports");

type Education = ResumeData["sections"]["education"]["items"][number];
const record = (fields: Partial<Education>): Education => ({
	id: generateId(),
	hidden: false,
	school: "",
	degree: "",
	grade: "",
	area: "",
	location: "",
	period: "",
	dates: { start: "", end: "", present: false },
	website: { url: "", label: "", inlineLink: false },
	description: "",
	...fields,
});

// RX-158: a degree long enough to wrap over several lines beside the school must stay in its own record.
it.each(templateSchema.options)(
	"keeps two Education records apart when the first degree wraps, in %s",
	async (template) => {
		const source = structuredClone(defaultResumeData);
		source.basics.name = "Jordan Sample";
		source.picture.hidden = true;
		source.metadata.layout.pages = [{ fullWidth: true, main: ["education"], sidebar: [] }];
		source.metadata.design.entry = { layout: "stacked", lead: "organization", accent: "none" };
		source.metadata.typography.body = { ...source.metadata.typography.body, fontSize: 11.5, lineHeight: 1.9 };
		source.sections.education.items = [
			record({
				school: "University of California, Berkeley",
				degree: "Bachelor of Engineering (Honours) in Electrical Engineering and Computer Science",
				area: "Electrical Engineering",
				location: "Berkeley, CA",
				period: "May 2014",
				dates: { start: "2014-05", end: "", present: false },
			}),
			record({
				school: "Imperial College London",
				degree: "MSc",
				area: "Data Science",
				grade: "Distinction",
				location: "London, UK",
				period: "2015 – 2016",
				dates: { start: "2015", end: "2016", present: false },
			}),
		];
		const file = await createResumePdfFile({ data: source, template, filename: `education-${template}.pdf` });
		create.mockClear();
		await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
		const saved = create.mock.calls[0]?.[0] as { data: ResumeData };
		const items = saved.data.sections.education.items;
		expect(items.map((item) => item.school)).toEqual(["University of California, Berkeley", "Imperial College London"]);
		for (const [index, original] of source.sections.education.items.entries()) {
			expect(items[index]).toMatchObject({
				degree: original.degree,
				grade: original.grade,
				area: original.area,
				// Every word went to a field: nothing is left over as a description.
				description: "",
				location: original.location,
				period: original.period,
			});
		}
	},
	60000,
);
