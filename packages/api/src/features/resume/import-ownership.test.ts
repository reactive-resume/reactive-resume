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
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "owner", banned: false }] }) }) }) },
}));
const { importResumeFile } = await import("./imports");

import { ownershipCases, ownershipSource } from "./fixtures/pdf-ownership";
const save = async (file: File) => {
	create.mockClear();
	await call(importResumeFile, { file, format: "PDF" }, { context: { locale: "en-US", reqHeaders: new Headers() } });
	expect(create).toHaveBeenCalledTimes(1);
	const saved = create.mock.calls[0]?.[0] as { data: ResumeData } | undefined;
	if (!saved) throw Error("No imported data");
	return saved.data;
};
it.each(ownershipCases)(
	"keeps identity and section ownership / $template / $kind",
	async (c) => {
		const source = ownershipSource(c);
		const file = await createResumePdfFile({ data: source, template: c.template, filename: "ownership.pdf" });
		const data = await save(file);
		const basics = { ...source.basics };
		if (c.template === "persian") basics.name = "JORDAN SAMPLE";
		if (c.template === "smeargle") basics.headline = [...basics.headline.toUpperCase()].join(" ").replace(/ {3}/g, " ");
		const pick = (b: ResumeData["basics"]) => ({
			...b,
			customFields: b.customFields.map(({ text, link }) => ({ text, link })),
		});
		expect(pick(data.basics)).toEqual(pick(basics));
		expect(data.summary.content).toBe(source.summary.content);
		expect(data.customSections).toHaveLength(1);
		expect(data.customSections[0]?.items[0]).toMatchObject({
			content:
				source.customSections[0]?.items[0] && "content" in source.customSections[0].items[0]
					? source.customSections[0].items[0].content
					: "",
		});
		const withoutIds = (items: unknown[]) =>
			JSON.parse(JSON.stringify(items, (key, value) => (key === "id" ? undefined : value)));
		expect(withoutIds(data.sections.education.items)).toEqual(withoutIds(source.sections.education.items));
		expect(withoutIds(data.sections.projects.items)).toEqual(withoutIds(source.sections.projects.items));
		for (const key of ["awards", "certifications", "publications", "volunteer"] as const) {
			const actual = data.sections[key].items[0];
			const expected = source.sections[key].items[0];
			expect(actual).toBeDefined();
			if (!actual || !expected) throw Error("Missing section record");
			// Existing positional mappings retain secondary header fields in descriptions.
			expect(actual.dates).toEqual(expected.dates);
			expect(actual.description).toContain(expected.description);
		}
		expect(data.sections.skills.items[0]?.name).toBe(source.sections.skills.items[0]?.name);
		expect(data.sections.languages.items[0]?.language).toBe(source.sections.languages.items[0]?.language);
		expect(data.sections.interests.items[0]?.name).toBe(source.sections.interests.items[0]?.name);

		expect(
			data.sections.experience.items.map(({ company, position, location, period, dates, description }) => ({
				company,
				position,
				location,
				period,
				dates,
				description,
			})),
		).toEqual(
			source.sections.experience.items.map(({ company, position, location, period, dates, description }) => ({
				company,
				position,
				location,
				period,
				dates,
				description,
			})),
		);
	},
	60000,
);

// Real dense input must take the bounded fallback and retain every cell, not freeze the event loop.
it("keeps every cell of a dense two-page PDF through authenticated import", async () => {
	const file = new File([readFileSync(new URL("./fixtures/dense-2p.pdf", import.meta.url))], "dense.pdf");
	const data = await save(file);
	const words = data.summary.content.match(/w\d+x\d+y\d+/g);
	const expected = Array.from({ length: 2 }, (_, page) =>
		Array.from({ length: 100 }, (_, row) =>
			Array.from({ length: 8 }, (_, column) => `w${page}x${row}y${column}`),
		).flat(),
	).flat();
	expect(words).toEqual(expected);
});

it("keeps all wrapped name-font fragments out of an inset contact location", async () => {
	const data = await save(
		new File([readFileSync(new URL("./fixtures/glalie-narrow.pdf", import.meta.url))], "narrow.pdf"),
	);
	expect(data.basics).toEqual({
		name: "Fic tio na l Re vie we r",
		headline: "",
		email: "reviewer@example.invalid",
		phone: "",
		location: "",
		website: { url: "", label: "" },
		customFields: [],
	});
	expect(
		data.sections.experience.items.map(({ company, position, location, period, description }) => ({
			company,
			position,
			location,
			period,
			description,
		})),
	).toEqual([
		{
			company: "eBay",
			position: "Engineer, Platform",
			location: "Remote",
			period: "2020 – 2021",
			description:
				"<ul><li>Built &lt;systems&gt; &amp; tools for Global Customers With Careful Accessibility Reviews Across Every Product Surface And Deployment And Better Reliability Across All Supported Devices</li><li>Research</li><li>Delivered Capitalized Continuation Across Each Product Surface Without A Final Full Stop</li></ul>",
		},
		{
			company: "3M",
			position: "Director, Product",
			location: "Berlin, Germany",
			period: "2019 – 2020",
			description: "<ul><li>Second role delivery with café, naïve, Straße, €25, £30, ±5% and ≥99% uptime.</li></ul>",
		},
	]);
	// Existing narrow wrapped-label mapping is incomplete in v8 too; every body fragment must survive.
	expect(
		data.customSections.flatMap((section) => section.items.map((item) => ("content" in item ? item.content : ""))),
	).toEqual([
		"<p>Engin eerin</p><p>g Advan ced</p><p>TypeSc ript, Resear ch, Tools</p>",
		"<p>Experi enced profes sional buildi</p><p>ng</p><p>access ible syste ms.</p>",
	]);
});
