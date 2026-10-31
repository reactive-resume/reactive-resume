import type { ProposeResumeEditsInput } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createEntry } from "@reactive-resume/resume/entries";
import { applyProposal, applyResumeProposals, collectPassages, readTarget } from "@reactive-resume/resume/proposals";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("../resume/service", () => ({ resumeService: {} }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));
const { resolveDocumentEdits } = await import("./document");

function fixture() {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = resumeDataSchema.parse({
		...data,
		sections: {
			...data.sections,
			experience: {
				...data.sections.experience,
				items: [
					{
						...createEntry("experience"),
						id: "kettle",
						company: "Studio Kettle",
						position: "Designer",
						description: "<p>Designed clear interfaces.</p>",
					},
					{
						...createEntry("experience"),
						id: "lantern",
						company: "Lantern Studio",
						position: "Designer",
						roles: [{ id: "role", position: "Designer", period: "2021 - 2022", description: "<p>Led reviews.</p>" }],
					},
				],
			},
		},
	}).sections.experience.items;
	const passages = collectPassages(data, {
		includeEmpty: true,
		summary: "Summary",
		sectionTitle: (id) => id,
		entryTitle: (_type, entry) => String(entry.company ?? ""),
		bullet: (n) => `bullet ${n}`,
		paragraph: (n) => `paragraph ${n}`,
	});
	const anchor = passages.find((passage) => passage.target.itemId === "kettle");
	if (!anchor) throw new Error("Missing fixture paragraph");
	const document = {
		kind: "resume" as const,
		resume: data,
		name: "Fictional",
		updatedAt: new Date(),
		locked: false,
		applicationId: null,
		passages,
		read: (target: Parameters<typeof readTarget>[1]) => readTarget(data, target),
		view: {},
	};
	const resolve = (changes: ProposeResumeEditsInput["changes"]) =>
		resolveDocumentEdits(document, { title: "Review changes", changes });
	return { data, anchor, resolve };
}

describe("resume proposal review contract", () => {
	it.each([
		"Patents\n=======\nUS 12,345,678 B2",
		"> ## Patents\n> US 12,345,678 B2",
		"- > ## Brevets\n  > FR 12,345",
		"> 特許\n> =======\n> JP 12345",
		"Intro\n\n<div><blockquote><h2>Languages</h2></blockquote></div>",
		"First paragraph.\n\nSecond paragraph.",
	])("rejects structural/multiple blocks before flattening: %s", (text) => {
		const { data, anchor, resolve } = fixture();
		const original = structuredClone(data);
		const output = resolve([
			{ kind: "text", sectionId: "experience", passageId: anchor.id, text, add: true, why: "Requested wording." },
		]);
		for (const edit of output.edits) applyProposal(data, { ...edit, target: anchor.target, source: "assistant" });
		expect(data).toEqual(original);
		expect(output.edits).toEqual([]);
		expect(output.skipped).toHaveLength(1);
	});

	it.each([
		'Delivered the workshop "## Languages".',
		"`Patents\n=======`",
		"- Shipped accessible forms.",
		"Updated skills gained in my role.",
	])("preserves legitimate quoted text and single bullets: %s", (text) => {
		const { data, anchor, resolve } = fixture();
		const output = resolve([
			{ kind: "text", sectionId: "experience", passageId: anchor.id, text, add: true, why: "User supplied." },
		]);
		expect(output.skipped).toEqual([]);
		const edit = output.edits[0];
		if (!edit) throw new Error("Expected supported edit");
		expect(applyProposal(data, { ...edit, target: anchor.target, source: "assistant" })).toBe(true);
		expect(data.sections.experience.items[0]?.description).not.toBe("<p>Designed clear interfaces.</p>");
	});

	it.each([false, true])(
		"keeps shared-anchor additions with a rewrite in typed proposals (structural set: %s)",
		(mixed) => {
			const { data, anchor, resolve } = fixture();
			const original = structuredClone(data);
			const changes: ProposeResumeEditsInput["changes"] = [
				{ kind: "text", sectionId: "experience", passageId: anchor.id, text: "Rewritten passage.", why: "Rewrite." },
				{
					kind: "text",
					sectionId: "experience",
					passageId: anchor.id,
					text: "First added fact.",
					add: true,
					why: "First fact.",
				},
				{
					kind: "text",
					sectionId: "experience",
					passageId: anchor.id,
					text: "Second added fact.",
					add: true,
					why: "Second fact.",
				},
			];
			if (mixed)
				changes.push({
					kind: "field",
					target: { sectionId: "basics", field: "headline" },
					before: "",
					value: "Design lead",
					why: "Headline.",
				});
			const output = resolve(changes);
			expect(data).toEqual(original);
			expect(output.skipped).toEqual([]);
			expect(output.edits).toHaveLength(mixed ? 1 : 3);
			const edits = output.edits.map((edit) => ({ ...edit, source: "assistant" as const }));
			expect(applyResumeProposals(data, edits)).toEqual({ applied: edits, stale: [] });
			expect(data.sections.experience.items[0]?.description).toBe(
				"<p>Rewritten passage.</p><p>First added fact.</p><p>Second added fact.</p>",
			);
			if (mixed) expect(data.basics.headline).toBe("Design lead");
		},
	);

	it("rejects section headings inside new entry, role and custom-section content while keeping normal rich-text bullets", () => {
		const { data, resolve } = fixture();
		const output = resolve([
			{
				kind: "entry",
				sectionId: "experience",
				type: "experience",
				entryJson: JSON.stringify({
					...createEntry("experience"),
					company: "Heading",
					description: "<div><blockquote><h2>Languages</h2></blockquote></div>",
				}),
				why: "Invalid heading.",
			},
			{
				kind: "entry",
				sectionId: "experience",
				type: "experience",
				entryJson: JSON.stringify({
					...createEntry("experience"),
					company: "Nested",
					roles: [{ id: "new-role", position: "Designer", period: "", description: "Brevets\n=======" }],
				}),
				why: "Invalid nested heading.",
			},
			{
				kind: "section",
				type: "summary",
				title: "New section",
				entriesJson: JSON.stringify([{ ...createEntry("summary"), content: "<h2>Certifications</h2><p>CPACC</p>" }]),
				why: "Invalid section body.",
			},
			{
				kind: "entry",
				sectionId: "experience",
				type: "experience",
				entryJson: JSON.stringify({
					...createEntry("experience"),
					company: "Supported",
					description: '<p>Presented "## Languages".</p><ul><li>Built accessible forms.</li></ul>',
				}),
				why: "Normal rich text.",
			},
		]);
		expect(output.skipped).toHaveLength(3);
		const edit = output.edits[0];
		if (!edit) throw new Error("Expected supported subset");
		expect(applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
			true,
		);
		expect(data.sections.experience.items).toHaveLength(3);
		expect(data.sections.experience.items[2]?.company).toBe("Supported");
		expect(data.customSections).toEqual([]);
	});

	it("identifies the original employer and role, and retains each accepted change's rationale", () => {
		const { data, resolve } = fixture();
		const output = resolve([
			{
				kind: "field",
				target: { sectionId: "experience", itemId: "lantern", field: "position" },
				before: "Designer",
				value: "Senior Designer",
				why: "Promotion at Lantern Studio.",
			},
			{
				kind: "field",
				target: { sectionId: "experience", itemId: "lantern", roleId: "role", field: "position" },
				before: "Designer",
				value: "Lead Designer",
				why: "Lead role in 2021.",
			},
		]);
		const edit = output.edits[0];
		if (!edit) throw new Error("Expected field set");
		expect(applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
			true,
		);
		expect(data.sections.experience.items[0]?.position).toBe("Designer");
		expect(data.sections.experience.items[1]).toMatchObject({
			position: "Senior Designer",
			roles: [{ position: "Lead Designer" }],
		});
		expect(edit.before).toContain("Lantern Studio");
		expect(edit.before).toContain("2021");
		expect(edit.why).toContain("Promotion at Lantern Studio.");
		expect(edit.why).toContain("Lead role in 2021.");
	});

	it("reviews nondefault levels, icons and role/parent fields that export Markdown omits", () => {
		const { data, resolve } = fixture();
		const output = resolve([
			{
				kind: "entry",
				type: "languages",
				sectionId: "languages",
				entryJson: JSON.stringify({ ...createEntry("languages"), language: "German", level: 5 }),
				why: "User supplied maximum proficiency.",
			},
			{
				kind: "entry",
				type: "skills",
				sectionId: "skills",
				entryJson: JSON.stringify({
					...createEntry("skills"),
					name: "TypeScript",
					level: 5,
					icon: "code",
					iconColor: "#ff0000",
				}),
				why: "User supplied skill styling and level.",
			},
			{
				kind: "entry",
				type: "experience",
				sectionId: "experience",
				entryJson: JSON.stringify({
					...createEntry("experience"),
					company: "Review both",
					position: "Intern",
					roles: [{ id: "role", position: "Director", period: "", description: "<p>Reviewed designs.</p>" }],
				}),
				why: "Both positions must be visible.",
			},
		]);
		const edit = output.edits[0];
		if (!edit) throw new Error("Expected entry set");
		expect(applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
			true,
		);
		expect(data.sections.languages.items[0]?.level).toBe(5);
		expect(data.sections.skills.items[0]).toMatchObject({ level: 5, icon: "code", iconColor: "#ff0000" });
		expect(edit.after).toContain("Level: 5/5");
		expect(edit.after).toContain("Icon: code");
		expect(edit.after).toContain("Icon color: #ff0000");
		expect(edit.after).toContain("Position: Intern");
		expect(edit.after).toContain("Position: Director");
	});
});

describe("structural review completeness", () => {
	it.each([
		"Languages\nGerman: Native\nCertifications\nCPACC\nSkills\nTypeScript",
		"Languages\r\nGerman: Native\r\nCertifications\r\nCPACC",
		"Languages\u2028German: Native\u2029Certifications\u0085CPACC",
		"Languages  \nGerman: Native",
		"Langues\nFrançais : natif\nCertifications\nCPACC",
		"言語\n日本語：母語\n資格\nCPACC",
		"اللغات\nالعربية: اللغة الأم\nالشهادات\nCPACC",
	])("declines ambiguous multiline records while retaining supported mixed changes: %s", (text) => {
		const { data, anchor, resolve } = fixture();
		const out = resolve([
			{
				kind: "field",
				target: { sectionId: "basics", field: "headline" },
				before: "",
				value: "Design lead",
				why: "Requested headline.",
			},
			{
				kind: "text",
				sectionId: "experience",
				passageId: anchor.id,
				text: "Used skills gained in my role.",
				add: true,
				why: "Requested bullet.",
			},
			{ kind: "text", sectionId: "experience", passageId: anchor.id, text, add: true, why: "Requested entries." },
		]);
		expect(out.skipped).toHaveLength(1);
		expect(out.skipped[0]?.reason).toContain("Write");
		const edit = out.edits[0];
		if (!edit) throw new Error("Missing supported subset");
		expect(applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
			true,
		);
		expect(data.basics.headline).toBe("Design lead");
		expect(data.sections.experience.items[0]?.description).toBe(
			"<p>Designed clear interfaces.</p><p>Used skills gained in my role.</p>",
		);
	});

	it.each(["experience", "education", "projects", "volunteer", "awards", "certifications", "publications"] as const)(
		"reviews normalized and underlying dates for %s",
		(type) => {
			for (const [raw, present] of [
				[undefined, true],
				[undefined, false],
				["Different displayed dates", true],
				["Different displayed dates", false],
			] as const) {
				const { data, resolve } = fixture();
				const out = resolve([
					{
						kind: "entry",
						type,
						sectionId: type,
						entryJson: JSON.stringify({
							...createEntry(type),
							dates: { start: "2021-03", end: "2022-04", present, ...(raw ? { raw } : {}) },
						}),
						why: "Supplied dates.",
					},
				]);
				const edit = out.edits[0];
				if (!edit) throw new Error("Missing dated entry");
				expect(
					applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" }),
				).toBe(true);
				const entry = data.sections[type].items.at(-1);
				if (!entry) throw new Error("Missing accepted entry");
				expect(entry.dates).toMatchObject({ start: "2021-03", end: "2022-04", present });
				expect(edit.after).toContain("Start: 2021-03");
				expect(edit.after).toContain("End: 2022-04");
				expect(edit.after).toContain(`Present: ${present}`);
				expect(edit.after).toContain("period" in entry ? entry.period : entry.date);
				if (raw) expect(edit.after).toContain(`Raw: ${raw}`);
			}
		},
	);

	it.each([
		["single quotes", "href='https://fictional-proof.example/single'", "https://fictional-proof.example/single"],
		["double quotes", 'href="https://fictional-proof.example/double"', "https://fictional-proof.example/double"],
		["unquoted", "href=https://fictional-proof.example/bare", "https://fictional-proof.example/bare"],
		["entities", "href='https://fictional-proof.example/?a=1&amp;b=2'", "https://fictional-proof.example/?a=1&b=2"],
		[
			"escaped destination",
			"href='https://fictional-proof.example/a%20b?next=%2Fproof'",
			"https://fictional-proof.example/a%20b?next=%2Fproof",
		],
	])("discloses %s link destinations in accepted rich text", (_name, attribute, destination) => {
		const { data, resolve } = fixture();
		const description = `<p>Built <a ${attribute}>proof</a>.</p>`;
		const out = resolve([
			{
				kind: "entry",
				type: "projects",
				sectionId: "projects",
				entryJson: JSON.stringify({ ...createEntry("projects"), name: "Fictional project", description }),
				why: "Supplied project link.",
			},
		]);
		const edit = out.edits[0];
		if (!edit) throw new Error("Missing linked entry");
		expect(applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
			true,
		);
		expect(data.sections.projects.items[0]?.description).toBe(description);
		expect(edit.after).toContain(destination);
		expect(edit.after).toContain("Built proof.");
	});

	it.each([
		[
			"experience",
			"company",
			{ position: "Designer", location: "London", period: "2021" },
			{ position: "Designer", location: "Paris", period: "2024" },
			"Paris",
		],
		[
			"education",
			"school",
			{ degree: "BA", area: "Design", period: "2021" },
			{ degree: "MA", area: "Arts", period: "2024" },
			"MA",
		],
		["projects", "name", { period: "2021" }, { period: "2024" }, "2024"],
		[
			"volunteer",
			"organization",
			{ location: "London", period: "2021" },
			{ location: "Paris", period: "2024" },
			"Paris",
		],
		["awards", "title", { awarder: "Red Cross", date: "2021" }, { awarder: "St John", date: "2024" }, "St John"],
		["certifications", "title", { issuer: "Red Cross", date: "2021" }, { issuer: "St John", date: "2024" }, "St John"],
		[
			"publications",
			"title",
			{ publisher: "Red Cross", date: "2021" },
			{ publisher: "St John", date: "2024" },
			"St John",
		],
		["profiles", "network", { username: "red" }, { username: "john" }, "john"],
		["references", "name", { position: "Manager", phone: "111" }, { position: "Director", phone: "222" }, "Director"],
		["languages", "language", { fluency: "B1" }, { fluency: "C2" }, "C2"],
		["skills", "name", { proficiency: "Basic" }, { proficiency: "Advanced" }, "Advanced"],
		["interests", "name", {}, {}, "Entry 2"],
	] as const)("distinguishes %s identities and changes only selected entry", (type, field, first, second, identity) => {
		const { data, resolve } = fixture();
		const records = [first, second].map((fields, index) => ({
			...createEntry(type),
			...fields,
			[field]: "Same title",
			id: `same-${index}`,
		}));
		Object.assign(data.sections[type], { items: records });
		const a = resolve([
			{
				kind: "field",
				target: { sectionId: type, itemId: "same-0", field },
				before: "Same title",
				value: "Updated",
				why: "Requested update.",
			},
		]).edits[0];
		const b = resolve([
			{
				kind: "field",
				target: { sectionId: type, itemId: "same-1", field },
				before: "Same title",
				value: "Updated",
				why: "Requested update.",
			},
		]).edits[0];
		if (!a || !b) throw new Error("Missing field proposals");
		expect(b.before).toContain(identity);
		expect(a.before).not.toBe(b.before);
		expect(b.why).toBe("Requested update.");
		expect(applyProposal(data, { ...b, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
			true,
		);
		expect((data.sections[type].items[0] as Record<string, unknown>)[field]).toBe("Same title");
		expect((data.sections[type].items[1] as Record<string, unknown>)[field]).toBe("Updated");
	});

	it.each([
		["custom-a", "custom-b"],
		["certifications", "custom-a"],
		["certifications", "awards"],
	] as const)("distinguishes same-titled sections %s / %s in displayed order", (first, second) => {
		for (const entryField of [false, true]) {
			const { data, resolve } = fixture();
			for (const id of [first, second]) {
				const type = id === "awards" ? "awards" : "certifications";
				const item = {
					...createEntry(type),
					id: `${id}-entry`,
					title: "First Aid",
					date: "2024",
					...(type === "awards" ? { awarder: "Red Cross" } : { issuer: "Red Cross" }),
				};
				if (id.startsWith("custom"))
					data.customSections.push({
						...data.sections.certifications,
						id,
						type: "certifications",
						title: "Training",
						items: [item],
					});
				else Object.assign(data.sections[id as "awards" | "certifications"], { title: "Training", items: [item] });
			}
			const page = data.metadata.layout.pages[0];
			if (!page) throw new Error("Missing layout page");
			page.main = [second, first];
			page.sidebar = [];
			const changes = [first, second].map(
				(sectionId) =>
					resolve([
						{
							kind: "field",
							target: { sectionId, ...(entryField ? { itemId: `${sectionId}-entry` } : {}), field: "title" },
							before: entryField ? "First Aid" : "Training",
							value: "Updated",
							why: "Requested update.",
						},
					]).edits[0],
			);
			const [a, b] = changes;
			if (!a || !b) throw new Error("Missing section-targeted proposals");
			expect(a.before).not.toBe(b.before);
			expect(a.before).toContain("Section 2");
			expect(b.before).toContain("Section 1");
			expect(b.after).toContain("Section 1");
			expect(applyProposal(data, { ...b, target: { sectionId: "resume", field: "data" }, source: "assistant" })).toBe(
				true,
			);
			const title = (id: string) => {
				const section =
					data.customSections.find((section) => section.id === id) ?? data.sections[id as "certifications"];
				return entryField ? (section.items[0] as { title: string }).title : section.title;
			};
			expect(title(first)).toBe(entryField ? "First Aid" : "Training");
			expect(title(second)).toBe("Updated");
		}
	});

	it("distinguishes duplicate roles and identical custom certification entries by visible order", () => {
		const { data, resolve } = fixture();
		const parent = data.sections.experience.items[1];
		if (!parent) throw new Error("Missing employer");
		parent.roles = ["first", "second"].map((id) => ({ id, position: "Designer", period: "2021", description: "" }));
		data.customSections = [
			{
				id: "training",
				type: "certifications",
				title: "Training",
				icon: "",
				columns: 1,
				hidden: false,
				keepTogether: false,
				startOnNewPage: false,
				items: ["first", "second"].map((id) => ({
					...createEntry("certifications"),
					id,
					title: "First Aid",
					issuer: "Red Cross",
					date: "2021",
				})),
			},
		];
		for (const [sectionId, itemId, roleId, field, before] of [
			["experience", "lantern", "second", "position", "Designer"],
			["training", "second", undefined, "title", "First Aid"],
		] as const) {
			const out = resolve([
				{
					kind: "field",
					target: { sectionId, itemId, ...(roleId ? { roleId } : {}), field },
					before,
					value: "Updated",
					why: "Second entry requested.",
				},
			]);
			const edit = out.edits[0];
			if (!edit) throw new Error("Missing duplicate-identity proposal");
			expect(edit.before).toContain(roleId ? "Role 2" : "Entry 2");
			expect(
				applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" }),
			).toBe(true);
		}
		expect(data.sections.experience.items[1]?.roles[0]?.position).toBe("Designer");
		expect(data.sections.experience.items[1]?.roles[1]?.position).toBe("Updated");
		expect(data.customSections[0]?.items[0]).toMatchObject({ title: "First Aid" });
	});
});
