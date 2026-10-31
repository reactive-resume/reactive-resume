import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vite-plus/test";
import { PgDialect } from "drizzle-orm/pg-core";
import { proposeResumeEditsInputSchema } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { createEntry } from "@reactive-resume/resume/entries";
import {
	applyProposal,
	collectPassages,
	entryText,
	getProposalState,
	getStateIn,
	readTarget,
	resumeStructureSnapshot,
} from "@reactive-resume/resume/proposals";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("../resume/service", () => ({ resumeService: {} }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));

const { NOT_JOB_COPY_MESSAGE, findPosting, resolveEdits, resolveDocumentEdits, withUsableTailoring } =
	await import("./document");

function makeDocument() {
	const data = structuredClone(defaultResumeData);
	data.summary.content = "";
	data.sections.experience.items = [
		{
			id: "lumen",
			hidden: false,
			company: "Lumen Health",
			position: "Designer",
			location: "",
			period: "",
			website: { url: "", label: "", inlineLink: false },
			description: "<ul><li><p>Built the design system</p></li><li><p>Ran usability sessions</p></li></ul>",
			roles: [],
		} as never,
	];
	const passages = collectPassages(data, {
		includeEmpty: true,
		summary: "Summary",
		sectionTitle: () => "Experience",
		entryTitle: () => "Lumen Health",
		bullet: (n) => `bullet ${n}`,
		paragraph: (n) => `paragraph ${n}`,
	});
	const first = passages[1];
	const second = passages[2];
	if (!first || !second) throw new Error("Expected experience bullets");
	return {
		data,
		passages,
		first,
		second,
		document: {
			kind: "resume" as const,
			resume: data,
			name: "Resume",
			updatedAt: new Date(),
			locked: false,
			applicationId: null as string | null,
			passages,
			read: (target: Parameters<typeof readTarget>[1]) => readTarget(data, target),
			entry: (target: Parameters<typeof entryText>[1]) => entryText(data, target),
			view: {} as Record<string, unknown>,
		},
	};
}

describe("agent documents", () => {
	it.each(["entry", "section"])(
		"refuses legacy cover-letter %s proposals before they can create another document",
		(kind) => {
			const { data, document } = makeDocument();
			const before = structuredClone(data);
			const change =
				kind === "entry"
					? {
							kind,
							sectionId: "legacy-letter",
							type: "cover-letter",
							entryJson: JSON.stringify(createEntry("cover-letter")),
							why: "Requested letter.",
						}
					: {
							kind,
							type: "cover-letter",
							title: "Cover letter",
							entriesJson: JSON.stringify([createEntry("cover-letter")]),
							why: "Requested letter.",
						};
			expect(proposeResumeEditsInputSchema.safeParse({ title: "Letter", changes: [change] }).success).toBe(false);
			expect(() => resolveDocumentEdits(document, { title: "Letter", changes: [change] })).toThrow();
			expect(data).toEqual(before);
		},
	);
	it("reads the explicitly chosen application through an owner-scoped query", async () => {
		const where = vi.fn((_predicate: SQL) => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }));
		dbMock.select.mockReturnValue({ from: () => ({ where }) });
		await findPosting("alice", "base", { kind: "resume", applicationId: "other-job" }, "clicked-job");
		const predicate = where.mock.calls[0]?.[0];
		if (!predicate) throw new Error("Expected application query");
		const query = new PgDialect().sqlToQuery(predicate);
		expect(query.sql).toContain('"application"."user_id"');
		expect(query.sql).toContain('"application"."id"');
		expect(query.params).toEqual(["alice", "clicked-job"]);
	});

	it("places rewrites, additions and an empty summary, and skips edits on text that changed", () => {
		const { document, passages } = makeDocument();
		const [summary, first, second] = passages;
		if (!summary || !first || !second) throw new Error("Expected three passages");
		expect(summary.html).toBe("");

		const output = resolveEdits(document, {
			title: "Tailor",
			edits: [
				{
					passageId: first.id,
					text: "Built the Lumen design system and rolled it out",
					why: "Leads with the rollout.",
				},
				{ passageId: second.id, text: "Introduced monthly accessibility reviews", why: "You said so.", add: true },
				{ passageId: summary.id, text: "Product designer for health tools.", why: "A summary." },
				{ passageId: "p_gone", text: "Anything", why: "Stale." },
				{ passageId: first.id, text: "Built the design system", why: "No change." },
			],
		});

		expect(output.title).toBe("Tailor");
		expect(output.edits.map(({ before, after, status }) => ({ before, after, status }))).toEqual([
			{
				before: "<p>Built the design system</p>",
				after: "<p>Built the Lumen design system and rolled it out</p>",
				status: "pending",
			},
			{
				before: "<p>Ran usability sessions</p></li>",
				after: "<p>Ran usability sessions</p></li><li><p>Introduced monthly accessibility reviews</p></li>",
				status: "pending",
			},
			{ before: "", after: "<p>Product designer for health tools.</p>", status: "pending" },
		]);
		expect(output.edits[0]?.location).toBe("Experience · Lumen Health · bullet 1");
		expect(output.skipped.map((skip) => skip.passageId)).toEqual(["p_gone", first.id]);
	});

	it("keeps citations unverified and flags an invented employer and skill behind a real citation", () => {
		const { document, passages } = makeDocument();
		const [, first, second] = passages;
		if (!first || !second) throw new Error("Expected passages");

		const output = resolveEdits(
			{ ...document, applicationId: "job" },
			{
				title: "Tailor to the posting",
				edits: [
					{
						passageId: first.id,
						text: "Led Kubernetes operations at Invented Corp",
						why: "Answers the platform requirement.",
						requirement: "Kubernetes operations",
						evidence: [second.id, "p_gone"],
						factIds: ["fact-shared", "fact-other-job"],
					},
				],
				requirements: [
					{ text: "Design systems", status: "edited", passageIds: [first.id] },
					{ text: "Kubernetes operations", status: "cited", passageIds: ["p_gone"] },
				],
			},
			{
				facts: new Map([["fact-shared", "Ran usability sessions weekly"]]),
				posting: { applicationId: "job", requirements: ["Design systems", "Accessibility audits"] },
			},
		);
		const [edit] = output.edits;

		// The model's pointer is shown as a citation; nothing claims it backs the edit.
		expect(edit?.evidence).toEqual([
			{ kind: "passage", location: "Experience · Lumen Health · bullet 2", text: "Ran usability sessions" },
			{ kind: "fact", id: "fact-shared" },
		]);
		// The unknown passage and the fact not shared with this turn don't resolve, and are counted.
		expect(edit?.unresolved).toBe(2);
		expect(edit?.unsupported).toEqual(
			expect.arrayContaining([
				{ kind: "term", text: "Kubernetes" },
				{ kind: "term", text: "Invented" },
				{ kind: "term", text: "Corp" },
			]),
		);
		expect(output.requirements).toEqual([
			// Claimed as edited, but no placed edit names it: only its citation is shown.
			{ text: "Design systems", status: "cited", evidence: [expect.objectContaining({ kind: "passage" })] },
			// "Cited" with nothing that resolves is a gap.
			{ text: "Kubernetes operations", status: "missing", evidence: [], unresolved: 1 },
			// A listed requirement the model left out stays visible.
			{ text: "Accessibility audits", status: "unassessed", evidence: [] },
		]);
	});

	it("keeps requirement gaps when no edit is placed, and marks requirements edited only by placed edits", () => {
		const { document, passages } = makeDocument();
		const copy = { ...document, applicationId: "job" };
		const placed = passages[1]?.id ?? "";
		const output = resolveEdits(
			copy,
			{
				title: "Tailor",
				edits: [
					{
						passageId: placed,
						text: "Built the design system for Lumen",
						why: "Systems.",
						requirement: "Design systems",
					},
					{ passageId: "p_gone", text: "Ran Kubernetes", why: "Platform.", requirement: "Kubernetes operations" },
				],
				requirements: [
					{ text: "Design systems", status: "edited" },
					{ text: "Kubernetes operations", status: "edited" },
				],
			},
			{ facts: new Map(), posting: { applicationId: "job", requirements: [] } },
		);
		expect(output.tailoredFor).toBe("job");
		expect(output.requirements?.map(({ text, status }) => ({ text, status }))).toEqual([
			{ text: "Design systems", status: "edited" },
			{ text: "Kubernetes operations", status: "unassessed" },
		]);

		const none = resolveEdits(
			copy,
			{
				title: "Tailor",
				edits: [{ passageId: "p_gone", text: "Ran Kubernetes", why: "Platform." }],
				requirements: [{ text: "Kubernetes operations", status: "missing" }],
			},
			{ facts: new Map(), posting: { applicationId: "job", requirements: [] } },
		);
		expect(none.edits).toEqual([]);
		expect(none.requirements).toEqual([{ text: "Kubernetes operations", status: "missing", evidence: [] }]);
	});

	it("records which job a resume set tailors to, and withholds sets this resume can't accept from every app", () => {
		const { document, passages } = makeDocument();
		const edit = { passageId: passages[1]?.id ?? "", text: "Built the design system for Lumen", why: "Tailors it." };
		const plain = resolveEdits(document, { title: "Edit", edits: [edit] });
		expect(plain).toHaveProperty("tailoredFor", null);

		const restored = (output: Record<string, unknown>, contextScope?: string) =>
			({
				id: "m",
				role: "assistant",
				...(contextScope ? { metadata: { contextScope } } : {}),
				parts: [
					{
						type: "tool-propose_edits",
						toolCallId: "c",
						state: "output-available",
						input: {},
						output: {
							...output,
							edits: [
								{ ...plain.edits[0], status: "pending" },
								{ ...plain.edits[0], id: "done", status: "accepted" },
							],
						},
					},
				],
			}) as never;
		const before = (message: Parameters<typeof withUsableTailoring>[0]) =>
			(message.parts[0] as { output: { edits: Array<{ before: string }>; revoked?: boolean } }).output;

		// No posting shared: usable anywhere. Tailored to job A: only job A's copy.
		expect(withUsableTailoring(restored({ tailoredFor: null }), null)).toEqual(restored({ tailoredFor: null }));
		expect(withUsableTailoring(restored({ tailoredFor: "job-a" }), "job-a")).toEqual(
			restored({ tailoredFor: "job-a" }),
		);
		const elsewhere = before(withUsableTailoring(restored({ tailoredFor: "job-a" }), null));
		expect(elsewhere.revoked).toBe(true);
		expect(elsewhere.edits[0]?.before).toBe('<p data-revoked=""></p>');
		// A decided edit keeps what happened to it.
		expect(elsewhere.edits[1]?.before).toBe(plain.edits[0]?.before);
		// An older set: usable only when its reply left the posting out, whatever the resume is linked to now.
		expect(before(withUsableTailoring(restored({}, "[true,true]"), null)).revoked).toBe(true);
		expect(before(withUsableTailoring(restored({}), "job-a")).revoked).toBe(true);
		expect(before(withUsableTailoring(restored({}, "[true,false]"), null)).revoked).toBeUndefined();
	});

	it("withholds a tailored structural change elsewhere: its snapshot can't apply, its summary stays readable", () => {
		const { data, document } = makeDocument();
		const copy = { ...document, applicationId: "job-a" };
		const field = {
			kind: "field" as const,
			target: { sectionId: "basics", field: "headline" },
			before: "",
			value: "Design lead",
			why: "Posting",
		};
		const posting = { applicationId: "job-a", requirements: [] };
		const output = resolveDocumentEdits(copy, { title: "Tailor", changes: [field] }, { facts: new Map(), posting });
		const message = {
			id: "reply",
			role: "assistant",
			parts: [{ type: "tool-propose_edits", toolCallId: "call", state: "output-available", output }],
		} as never;
		const [edit] =
			(withUsableTailoring(message, null) as { parts: Array<{ output: typeof output }> }).parts[0]?.output.edits ?? [];
		if (!edit?.snapshot || !output.edits[0]) throw new Error("Expected a structural change.");
		expect(edit.before).toBe(output.edits[0].before);
		expect(edit.snapshot.after).toBe(output.edits[0].snapshot?.after);
		const proposal = { ...edit, source: "assistant" as const };
		expect(getProposalState(data, proposal)).toBe("stale");
		expect(applyProposal(structuredClone(data), proposal)).toBe(false);
		// On the job's own copy it's untouched and still applies.
		expect(withUsableTailoring(message, "job-a")).toEqual(message);
	});

	it("refuses tailoring a resume that isn't the job's copy, for text and structural changes alike", () => {
		const { document, passages } = makeDocument();
		const passage = passages[1];
		if (!passage) throw new Error("Expected a passage.");
		const text = {
			kind: "text" as const,
			sectionId: passage.target.sectionId,
			passageId: passage.id,
			text: "Built the design system for Lumen",
			why: "Tailors it.",
		};
		const field = {
			kind: "field" as const,
			target: { sectionId: "basics", field: "headline" },
			before: document.resume?.basics.headline ?? "",
			value: "Design systems lead",
			why: "Tailors it.",
		};
		const posting = { applicationId: "job", requirements: [] };
		const review = { facts: new Map(), posting };

		for (const changes of [[text], [field], [text, field]])
			expect(() => resolveDocumentEdits(document, { title: "Tailor", changes }, review)).toThrow(NOT_JOB_COPY_MESSAGE);
		// The same changes without the posting are ordinary edits.
		expect(resolveDocumentEdits(document, { title: "Edit", changes: [text] }).edits).toHaveLength(1);
		// The job's own copy can be tailored, and says which job it's for.
		const copy = { ...document, applicationId: "job" };
		expect(resolveDocumentEdits(copy, { title: "Tailor", changes: [text, field] }, review)).toMatchObject({
			tailoredFor: "job",
			edits: [{ snapshot: expect.anything() }],
		});
	});
});

describe("typed resume proposals", () => {
	function accept(data: ReturnType<typeof makeDocument>["data"], output: ReturnType<typeof resolveDocumentEdits>) {
		const edit = output.edits[0];
		if (!edit) throw new Error("Expected a proposal set");
		return applyProposal(data, { ...edit, target: { sectionId: "resume", field: "data" }, source: "assistant" });
	}

	it("adds Patents as typed entries in its own section and changes headline without touching an unrelated description", () => {
		const { data, document } = makeDocument();
		const previous = data.sections.experience.items[0]?.description;
		const output = resolveDocumentEdits(document, {
			title: "Add patent and update headline",
			changes: [
				{
					kind: "section",
					type: "publications",
					title: "Patents",
					entriesJson: JSON.stringify([
						{
							...createEntry("publications"),
							title: "US 11,987,654 B2",
							publisher: "USPTO",
							date: "2024",
							description: "<p>Accessible contrast checking.</p>",
						},
					]),
					why: "Patent supplied by user.",
				},
				{
					kind: "field",
					target: { sectionId: "basics", field: "headline" },
					before: "",
					value: "Design engineer",
					why: "Requested headline.",
				},
			],
		});
		expect(output.skipped).toEqual([]);
		expect(output.edits[0]?.after).toContain("US 11,987,654 B2");
		expect(accept(data, output)).toBe(true);
		expect(data.basics.headline).toBe("Design engineer");
		expect(data.customSections[0]).toMatchObject({
			title: "Patents",
			type: "publications",
			items: [{ title: "US 11,987,654 B2", date: "2024", dates: { start: "2024", end: null, present: false } }],
		});
		expect(data.metadata.layout.pages[0]?.main).toContain(data.customSections[0]?.id);
		expect(data.sections.experience.items[0]?.description).toBe(previous);
		expect(data.summary.content).toBe("");
	});

	it.each(["Sprachen hinzufügen", "Ajouter des certifications", "أضف المهارات", "特許を追加"])(
		"rejects mismatched typed entries without reading natural-language intent: %s",
		(title) => {
			const { data, document, first } = makeDocument();
			const bullet = first;
			const previous = structuredClone(data);
			const output = resolveDocumentEdits(document, {
				title,
				changes: [
					{
						kind: "entry",
						type: "languages",
						sectionId: "experience",
						entryJson: JSON.stringify({ ...createEntry("languages"), language: "Deutsch", fluency: "Fließend" }),
						why: title,
					},
					{
						kind: "text",
						sectionId: "languages",
						passageId: bullet.id,
						text: "Deutsch — Fließend",
						add: true,
						why: title,
					},
					{
						kind: "text",
						sectionId: "experience",
						passageId: bullet.id,
						text: `## ${title}\nGerman — Fließend`,
						add: true,
						why: title,
					},
				],
			});
			expect(output.edits).toEqual([]);
			expect(output.skipped).toHaveLength(3);
			expect(data).toEqual(previous);
		},
	);

	it("adds Languages, Certifications and Skills to their owners and rejects cross-type record fields", () => {
		const { data, document } = makeDocument();
		const output = resolveDocumentEdits(document, {
			title: "Restore missing entries",
			changes: [
				{
					kind: "entry",
					sectionId: "languages",
					type: "languages",
					entryJson: JSON.stringify({ ...createEntry("languages"), language: "German", fluency: "Native" }),
					why: "Supplied.",
				},
				{
					kind: "entry",
					sectionId: "certifications",
					type: "certifications",
					entryJson: JSON.stringify({ ...createEntry("certifications"), title: "CPACC", issuer: "IAAP" }),
					why: "Supplied.",
				},
				{
					kind: "entry",
					sectionId: "skills",
					type: "skills",
					entryJson: JSON.stringify({
						...createEntry("skills"),
						name: "TypeScript",
						keywords: ["React", "Accessibility"],
					}),
					why: "Supplied.",
				},
				{
					kind: "entry",
					sectionId: "experience",
					type: "experience",
					entryJson: JSON.stringify({ ...createEntry("experience"), language: "German", fluency: "Native" }),
					why: "Wrong fields even with matching type.",
				},
			],
		});
		expect(output.skipped).toHaveLength(1);
		expect(accept(data, output)).toBe(true);
		expect(data.sections.languages.items[0]).toMatchObject({ language: "German", fluency: "Native" });
		expect(data.sections.certifications.items[0]).toMatchObject({ title: "CPACC", issuer: "IAAP" });
		expect(data.sections.skills.items[0]).toMatchObject({ name: "TypeScript", keywords: ["React", "Accessibility"] });
		expect(data.sections.experience.items).toHaveLength(1);
	});

	it("fills blank resume fields and typed entries without using Summary as an imported resume", () => {
		const { data, document } = makeDocument();
		data.sections.experience.items = [];
		const output = resolveDocumentEdits(document, {
			title: "Fill from old resume",
			changes: [
				{
					kind: "field",
					target: { sectionId: "basics", field: "name" },
					before: "",
					value: "Sam Example",
					why: "Supplied.",
				},
				{
					kind: "entry",
					sectionId: "experience",
					type: "experience",
					entryJson: JSON.stringify({
						...createEntry("experience"),
						company: "Lumen",
						position: "Designer",
						period: "2019 - 2022",
						roles: [
							{
								id: "old-role",
								position: "Design Lead",
								period: "2021 - 2022",
								description: "<p>Led accessibility reviews.</p>",
								dates: { start: null, end: null, present: false },
							},
						],
					}),
					why: "Supplied.",
				},
				{
					kind: "entry",
					sectionId: "education",
					type: "education",
					entryJson: JSON.stringify({ ...createEntry("education"), school: "Example University", degree: "BSc" }),
					why: "Supplied.",
				},
				{
					kind: "entry",
					sectionId: "skills",
					type: "skills",
					entryJson: JSON.stringify({ ...createEntry("skills"), name: "Accessibility" }),
					why: "Supplied.",
				},
			],
		});
		expect(output.skipped).toEqual([]);
		expect(accept(data, output)).toBe(true);
		expect(data.basics.name).toBe("Sam Example");
		expect(data.sections.experience.items[0]).toMatchObject({
			company: "Lumen",
			position: "Designer",
			dates: { start: "2019", end: "2022", present: false },
			roles: [{ position: "Design Lead", dates: { start: "2021", end: "2022", present: false } }],
		});
		expect(data.sections.experience.items[0]?.roles[0]?.id).not.toBe("old-role");
		expect(data.sections.education.items[0]).toMatchObject({ school: "Example University", degree: "BSc" });
		expect(data.summary.content).toBe("");
	});

	it("keeps legitimate bullets, quoted headings and mixed-request supported changes when another field is unsupported", () => {
		const { data, document, first } = makeDocument();
		const output = resolveDocumentEdits(document, {
			title: "Update skills gained in my role and headline",
			changes: [
				{
					kind: "field",
					target: { sectionId: "basics", field: "headline" },
					before: "",
					value: "Senior designer",
					why: "Requested.",
				},
				{
					kind: "field",
					target: { sectionId: "basics", field: "website" },
					before: "",
					value: "https://example.com",
					why: "Unsupported field.",
				},
				{
					kind: "text",
					sectionId: "experience",
					passageId: first.id,
					text: 'Taught the workshop "## Languages: Skills gained in my role".',
					add: true,
					why: "User supplied a legitimate bullet, including a quoted heading.",
				},
			],
		});
		expect(output.skipped).toHaveLength(1);
		expect(accept(data, output)).toBe(true);
		expect(data.basics.headline).toBe("Senior designer");
		expect(data.sections.experience.items[0]?.description).toContain("Skills gained in my role");
		expect(data.sections.experience.items[0]?.description).toContain("Built the design system");
	});

	it("cannot apply a structural snapshot over later local changes, or accept malformed stored snapshots", () => {
		const { data, document } = makeDocument();
		const output = resolveDocumentEdits(document, {
			title: "Headline",
			changes: [
				{
					kind: "field",
					target: { sectionId: "basics", field: "headline" },
					before: "",
					value: "Designer",
					why: "Requested.",
				},
			],
		});
		data.basics.name = "New local name";
		expect(accept(data, output)).toBe(false);
		expect(data.basics.name).toBe("New local name");
		expect(data.basics.headline).toBe("");
		const edit = output.edits[0];
		if (!edit) throw new Error("Expected proposal");
		expect(
			applyProposal(data, {
				...edit,
				target: { sectionId: "resume", field: "data" },
				snapshot: { before: resumeStructureSnapshot(data), after: "{}" },
				source: "assistant",
			}),
		).toBe(false);
		expect(data.basics.name).toBe("New local name");
	});

	it("keeps text-only bullet edits independent and makes new structural sets harmless to legacy clients", () => {
		const { data, document, first, second } = makeDocument();
		const output = resolveDocumentEdits(document, {
			title: "Improve bullets",
			changes: [
				{
					kind: "text",
					sectionId: "experience",
					passageId: first.id,
					text: "Added coaching using skills gained in my role.",
					add: true,
					why: "User supplied this fact.",
				},
				{
					kind: "text",
					sectionId: "experience",
					passageId: second.id,
					text: "Ran weekly usability sessions.",
					why: "Clearer cadence.",
				},
			],
		});
		expect(output.skipped).toEqual([]);
		expect(output.edits).toHaveLength(2);
		expect(output.edits.every((edit) => edit.snapshot === undefined)).toBe(true);
		const structural = resolveDocumentEdits(document, {
			title: "Add German",
			changes: [
				{
					kind: "entry",
					sectionId: "languages",
					type: "languages",
					entryJson: JSON.stringify({ ...createEntry("languages"), language: "German" }),
					why: "Requested.",
				},
			],
		});
		const edit = structural.edits[0];
		if (!edit) throw new Error("Expected structural proposal");
		const legacy = {
			...edit,
			target: { sectionId: "resume", field: "data" },
			source: "assistant" as const,
			snapshot: undefined,
		};
		expect(legacy.before).not.toBe("");
		expect(getStateIn(readTarget(data, legacy.target) ?? "", legacy)).toBe("stale");
		expect(applyProposal(data, legacy)).toBe(false);
		expect(legacy.after).toContain("German");
		expect(legacy.after).not.toContain('"metadata"');
	});

	it("does not accept legacy text-only payloads or section objects smuggled into text operations in the current tool contract", () => {
		const { document } = makeDocument();
		expect(() =>
			resolveDocumentEdits(document, {
				title: "Add Patents",
				edits: [{ passageId: "p", text: "## Patents ...", why: "Create a section." }],
			}),
		).toThrow("Read the document again");
		expect(
			proposeResumeEditsInputSchema.safeParse({
				title: "Add Patents",
				edits: [{ passageId: "p", text: "## Patents ...", why: "Create a section." }],
			}).success,
		).toBe(false);
		expect(
			proposeResumeEditsInputSchema.safeParse({
				title: "Add Patents",
				changes: [
					{
						kind: "text",
						sectionId: "experience",
						passageId: "p",
						text: "Anything",
						type: "publications",
						entriesJson: "[]",
						why: "Create a section.",
					},
				],
			}).success,
		).toBe(false);
	});
});
