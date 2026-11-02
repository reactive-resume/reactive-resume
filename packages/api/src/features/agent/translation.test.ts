import { expect, it } from "vite-plus/test";
import { createEntry } from "@reactive-resume/resume/entries";
import { applyResumeProposals } from "@reactive-resume/resume/proposals";
import { skillItemSchema, experienceItemSchema, projectItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { proposeTranslation, translationFields, translationView } from "./translation";

function fixture() {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.locale = "de-DE";
	data.basics.name = "Priya Raman";
	data.basics.email = "priya@example.test";
	data.basics.headline = "Product designer";
	data.basics.website = { url: "https://example.test", label: "Portfolio" };
	data.basics.customFields = [
		{ id: "custom", text: "Work permit", icon: "check", link: "https://example.test/permit" },
	];
	data.summary.content = "<p>Built <strong>teams</strong> &amp; tools.</p>";
	data.sections.skills.items = skillItemSchema
		.array()
		.parse([
			{ ...createEntry("skills"), id: "skill", name: "Research", proficiency: "Advanced", keywords: ["Interviews"] },
		]);
	data.sections.experience.items = experienceItemSchema.array().parse([
		{
			...createEntry("experience"),
			id: "job",
			company: "Kettle",
			roles: [
				{
					id: "role",
					position: "Designer",
					period: "During college",
					dates: { start: null, end: null, present: false, raw: "During college" },
					description: "<p>Led reviews.</p>",
				},
			],
		},
	]);
	data.sections.projects.items = projectItemSchema
		.array()
		.parse([{ ...createEntry("projects"), id: "hidden", hidden: true, name: "Secret project" }]);
	data.customSections = [
		{
			...data.sections.projects,
			id: "custom-section",
			type: "projects",
			title: "Selected work",
			items: [{ ...createEntry("projects"), name: "Toolkit" }],
		},
	];
	data.metadata.notes = "Private notes";
	const text: Record<string, string> = {
		"Product designer": "Produktdesignerin",
		"Work permit": "Arbeitserlaubnis",
		"Built ": "Aufgebaute ",
		teams: "Teams",
		" & tools.": " & Werkzeuge.",
		Research: "Forschung",
		Advanced: "Fortgeschritten",
		Interviews: "Interviews",
		Designer: "Designerin",
		"During college": "Während des Studiums",
		"Led reviews.": "Leitete Reviews.",
		"Selected work": "Ausgewählte Arbeiten",
		Toolkit: "Werkzeugkasten",
		Portfolio: "Arbeitsproben",
	};
	const fields = translationFields(data).map((field) => ({
		id: field.id,
		before: field.text,
		text: text[field.text] ?? field.text,
	}));
	return {
		data,
		fields,
		input: { locale: "de-DE", fields, why: "Review meaning, names and figures before accepting." },
	};
}

it("covers visible nested text and applies one reviewable translation without changing source, markup or destinations", () => {
	const { data, fields, input } = fixture();
	const original = structuredClone(data);
	expect(fields.map((field) => field.before)).toEqual([
		"Priya Raman",
		"Product designer",
		"Portfolio",
		"Work permit",
		"Built ",
		"teams",
		" & tools.",
		"Kettle",
		"Designer",
		"During college",
		"Led reviews.",
		"Research",
		"Advanced",
		"Interviews",
		"Selected work",
		"Toolkit",
	]);
	const output = proposeTranslation(data, input, "German copy");
	expect(output.edits).toHaveLength(1);
	expect(data).toEqual(original);
	const next = structuredClone(data);
	const applied = applyResumeProposals(
		next,
		output.edits.map((edit) => ({ ...edit, source: "assistant" as const })),
	);
	expect(applied.applied).toHaveLength(1);
	expect(next.basics.headline).toBe("Produktdesignerin");
	expect(next.basics.name).toBe("Priya Raman");
	expect(next.basics.email).toBe("priya@example.test");
	expect(next.basics.website).toEqual({ url: "https://example.test", label: "Arbeitsproben" });
	expect(next.basics.customFields[0]).toMatchObject({
		id: "custom",
		text: "Arbeitserlaubnis",
		link: "https://example.test/permit",
	});
	expect(next.summary.content).toBe("<p>Aufgebaute <strong>Teams</strong> &amp; Werkzeuge.</p>");
	expect(next.sections.experience.items[0]?.roles[0]?.position).toBe("Designerin");
	expect(next.sections.experience.items[0]?.roles[0]?.period).toBe("Während des Studiums");
	expect(next.sections.experience.items[0]?.roles[0]?.dates).toEqual({
		start: null,
		end: null,
		present: false,
		raw: "Während des Studiums",
	});
	expect(next.sections.skills.items[0]).toMatchObject({
		name: "Forschung",
		proficiency: "Fortgeschritten",
		keywords: ["Interviews"],
	});
	expect(next.customSections[0]).toMatchObject({ title: "Ausgewählte Arbeiten", items: [{ name: "Werkzeugkasten" }] });
	expect(next.sections.projects.items).toEqual(original.sections.projects.items);
	expect(next.metadata).toEqual(original.metadata);
	expect(JSON.stringify(output.edits.map(({ before, after }) => ({ before, after })))).not.toContain("Secret project");
	const changed = structuredClone(data);
	changed.basics.headline = "New wording";
	expect(
		applyResumeProposals(
			changed,
			output.edits.map((edit) => ({ ...edit, source: "assistant" as const })),
		).stale,
	).toHaveLength(1);
	const anotherLanguage = structuredClone(data);
	anotherLanguage.metadata.page.locale = "fr-FR";
	expect(
		applyResumeProposals(
			anotherLanguage,
			output.edits.map((edit) => ({ ...edit, source: "assistant" as const })),
		).stale,
	).toHaveLength(1);
});

it("rejects omitted, duplicate, invented, stale, hidden and wrong-language targets atomically", () => {
	const { data, input } = fixture();
	const original = structuredClone(data);
	const first = input.fields[0];
	if (!first) throw new Error("Missing fixture field");
	for (const fields of [
		input.fields.slice(1),
		[...input.fields, first],
		[...input.fields.slice(1), { ...first, id: "/metadata/notes" }],
		[{ ...first, before: "wrong" }, ...input.fields.slice(1)],
	]) {
		expect(() => proposeTranslation(data, { ...input, fields }, "Translation")).toThrow(/incomplete|changed/);
	}
	expect(() => proposeTranslation(data, { ...input, locale: "fr-FR" }, "Translation")).toThrow(/copy/);
	expect(data).toEqual(original);
});

it("escapes provider markup as text and warns when translations change figures", () => {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.locale = "de-DE";
	data.summary.content = '<p><a href="https://example.test">Led 5 teams</a></p>';
	const field = translationFields(data)[0];
	if (!field) throw new Error("Missing fixture field");
	const output = proposeTranslation(
		data,
		{
			locale: "de-DE",
			why: "Check translation",
			fields: [{ id: field.id, before: field.text, text: '<img src="https://evil.test">Leitete 8 Teams' }],
		},
		"Translation",
	);
	const edit = output.edits[0];
	if (!edit) throw new Error("Missing translation proposal");
	expect(edit.addsClaims).toBe(true);
	expect(edit.unsupported).toContainEqual({ kind: "figure", text: "8 Teams" });
	expect(edit.snapshot?.after).toContain("&lt;img");
	expect(edit.snapshot?.after).toContain("https://example.test");
});

it("keeps ordinary reading available when a resume exceeds the one-review translation budget", () => {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.locale = "de-DE";
	data.summary.content = `<p>${"x".repeat(100_001)}</p>`;
	expect(translationView(data, "de-DE")).toEqual({
		translationUnavailable: "This resume is too large for one translation review. Use a smaller copy.",
	});
	expect(() => proposeTranslation(data, { locale: "de-DE", fields: [], why: "Translate" }, "Translation")).toThrow(
		/too large/,
	);
});
