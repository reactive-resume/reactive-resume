import type { Proposal } from "./proposals";
import { describe, expect, it } from "vite-plus/test";
import { experienceItemSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	additionAfter,
	additionParts,
	passageLines,
	acknowledgeProposalApplications,
	applyProposal,
	applyProposals,
	applyTo,
	collectLetterPassages,
	collectPassages,
	entryText,
	getProposalState,
	getStateIn,
	readTarget,
	replaceBlockText,
	unverifiedClaims,
	withEditedText,
	writeTarget,
	resumeStructureSnapshot,
	applyResumeProposals,
} from "./proposals";

const labels = { body: "Letter", bullet: (n: number) => `bullet ${n}`, paragraph: (n: number) => `paragraph ${n}` };

const proposal = (before: string, after: string): Proposal => ({
	id: after,
	target: { sectionId: "summary", field: "content" },
	location: "Summary",
	before,
	after,
	why: "Clearer",
	status: "pending",
	source: "assistant",
});

it("keeps accepted identity through refinements and quote normalization without inferring unrelated acceptance", () => {
	const edit = proposal("<p>Old</p>", "<p>New</p>");
	const addition = proposal("<p>Old</p>", "<p>Old</p><p>Mentored two designers</p>");
	for (const accepted of [edit, addition]) {
		expect(getStateIn("<p>Manually refined</p>", { ...accepted, status: "accepted" })).toBe("accepted");
		expect(getStateIn("<p>Manually refined</p>", accepted, { [accepted.id]: true })).toBe("accepted");
		expect(getStateIn("<p>Old</p>", { ...accepted, status: "accepted" }, { [accepted.id]: false })).toBe("pending");
	}
	expect(getStateIn("<p>Old</p><p>Elsewhere</p><p>Mentored two designers</p>", addition)).toBe("pending");
	expect(getStateIn("<p>Changed</p>", addition)).toBe("stale");
});

it("applies quote-normalized originals safely without equating escaped markup to tags", () => {
	const edit = proposal("<p>They&#39;ve said &quot;yes&quot;.</p>", "<p>They&#39;ve delivered.</p>");
	const value = `<p>They've said "yes".</p>`;
	expect(getStateIn(value, edit)).toBe("pending");
	expect(applyTo(value, edit)).toBe("<p>They&#39;ve delivered.</p>");
	const addition = { ...edit, after: `${edit.before}<p>Added</p>` };
	expect(applyTo(value, addition)).toBe(`${value}<p>Added</p>`);
	expect(
		applyTo("<p><b>Claim</b></p>", { before: "<p>&lt;b&gt;Claim&lt;/b&gt;</p>", after: "<p>Wrong</p>" }),
	).toBeUndefined();
	expect(applyTo(`${value}${edit.before}`, edit)).toBeUndefined();
	expect(
		applyTo(`<p title='a>b&quot;c'>Old</p>`, { before: `<p title='a>b"c'>Old</p>`, after: "<p>Wrong target</p>" }),
	).toBeUndefined();
});

it("preserves proposal order, places additions before rewriting their anchor, and cannot accept the same IDs twice", () => {
	let content = "<ul><li><p>Old</p></li></ul>";
	const before = "<p>Old</p></li>";
	const first = proposal(before, `${before}<li><p>First</p></li>`);
	const second = proposal(before, `${before}<li><p>Second</p></li>`);
	const rewrite = proposal("<p>Old</p>", "<p>Rewritten</p>");
	const edits = [rewrite, first, second];
	const applications: Record<string, boolean> = {};
	const accept = () => {
		const result = applyProposals(
			edits,
			() => content,
			(_, value) => {
				content = value;
			},
			applications,
		);
		for (const edit of result.applied) applications[edit.id] = true;
		return result;
	};
	expect(accept()).toEqual({ applied: edits, stale: [] });
	expect(content).toBe("<ul><li><p>Rewritten</p></li><li><p>First</p></li><li><p>Second</p></li></ul>");
	content = "<ul><li><p>Refined anchor</p></li><li><p>Refined first</p></li><li><p>Second</p></li></ul>";
	expect(accept()).toEqual({ applied: [], stale: [] });
	expect(edits.map((edit) => getStateIn(content, edit, applications))).toEqual(["accepted", "accepted", "accepted"]);
});

it("reports real failures and does not infer application from identical text elsewhere", () => {
	const data = structuredClone(defaultResumeData);
	data.summary.content = "<p>Old</p><p>Elsewhere</p><p>Added</p>";
	const addition = proposal("<p>Old</p>", "<p>Old</p><p>Added</p>");
	const rewrite = proposal("<p>Old</p>", "<p>Rewritten</p>");
	const conflict = proposal("<p>Old</p>", "<p>Conflict</p>");
	const stale = proposal("<p>Gone</p>", "<p>New</p>");
	expect(
		applyProposals(
			[rewrite, addition, conflict, stale],
			(target) => readTarget(data, target),
			(target, value) => writeTarget(data, target, value),
		),
	).toEqual({ applied: [rewrite, addition], stale: [conflict, stale] });
	expect(data.summary.content).toBe("<p>Rewritten</p><p>Added</p><p>Elsewhere</p><p>Added</p>");
});

it("refuses missing or ambiguous targets and no-op proposals without reporting writes", () => {
	for (const value of [undefined, "<p>Changed</p>", "<p>Old</p><p>Old</p>"]) {
		const edit = proposal("<p>Old</p>", "<p>New</p>");
		expect(
			applyProposals(
				[edit],
				() => value,
				() => {
					throw new Error("Unexpected write");
				},
			),
		).toEqual({ applied: [], stale: [edit] });
	}
	const data = structuredClone(defaultResumeData);
	const missing = {
		...proposal("", "<p>New</p>"),
		target: { sectionId: "experience", itemId: "deleted", field: "description" },
	};
	expect(getProposalState(data, missing)).toBe("stale");
	expect(applyProposal(data, missing)).toBe(false);
	expect(applyTo("", { before: "", after: "" })).toBeUndefined();
});

it("compares structural snapshots by content across JSONB/date-normalized key order, including older snapshots", () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Sam Example";
	data.sections.experience.items = [
		{
			id: "legacy",
			hidden: false,
			company: "Kettle",
			position: "Designer",
			location: "",
			period: "",
			website: { url: "", label: "", inlineLink: false },
			description: "",
			roles: [{ id: "legacy-role", position: "Designer", period: "2021 - 2022", description: "" }],
		},
	];
	const { name, ...otherBasics } = data.basics;
	const reordered = { ...data, basics: { ...otherBasics, name } };
	expect(reordered).toEqual(data);
	expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(data));
	const oldSnapshot = JSON.stringify({
		basics: data.basics,
		summary: data.summary,
		sections: data.sections,
		customSections: data.customSections,
		layout: data.metadata.layout,
	});
	const after = structuredClone(data);
	after.basics.headline = "Design lead";
	const proposal = {
		id: "snapshot",
		source: "assistant" as const,
		status: "pending" as const,
		target: { sectionId: "resume", field: "data" },
		location: "Resume",
		before: "Headline: —",
		after: "Headline: Design lead",
		why: "Requested.",
		snapshot: { before: oldSnapshot, after: resumeStructureSnapshot(after) },
	};
	expect(getProposalState(reordered, proposal)).toBe("pending");
	const upgraded = structuredClone(reordered);
	const role = upgraded.sections.experience.items[0]?.roles[0];
	if (!role) throw new Error("Expected legacy role");
	role.dates = { start: "2021", end: "2022", present: false };
	role.period = "2021 – 2022";
	expect(getProposalState(upgraded, proposal)).toBe("pending");
	expect(data.sections.experience.items[0]?.roles[0]?.dates).toBeUndefined();
	role.dates.end = "2023";
	expect(getProposalState(upgraded, proposal)).toBe("stale");
	expect(applyProposal(upgraded, proposal)).toBe(false);
	expect(applyProposal(reordered, proposal)).toBe(true);
	expect(reordered.basics.headline).toBe("Design lead");
	expect(getProposalState(data, { ...proposal, status: "accepted" })).toBe("accepted");
	expect(getProposalState(data, { ...proposal, status: "accepted" }, { [proposal.id]: false })).toBe("pending");
	const changed = structuredClone(data);
	changed.basics.name = "Different author change";
	expect(applyProposal(changed, proposal)).toBe(false);
	expect(changed.basics.name).toBe("Different author change");
});

it("rejects ambiguous paragraphs instead of replacing the first occurrence", () => {
	const value = "<p>Repeated claim.</p><p>Different middle.</p><p>Repeated claim.</p>";
	expect(applyTo(value, { before: "<p>Repeated claim.</p>", after: "<p>Changed</p>" })).toBeUndefined();
	expect(additionAfter(value, "<p>Repeated claim.</p>", "Added")).toBeUndefined();
	expect(applyTo("<p>Unique</p>", { before: "<p>Unique</p>", after: "<p>$&</p>" })).toBe("<p>$&</p>");
});

it("collects and edits nested role descriptions and custom summaries without changing siblings", () => {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = [
		experienceItemSchema.parse({
			id: "company",
			hidden: false,
			company: "Kettle",
			position: "",
			location: "",
			period: "",
			description: "",
			website: { url: "", label: "" },
			roles: [
				{ id: "lead", position: "Lead", period: "", description: "<p>Led delivery.</p>" },
				{ id: "engineer", position: "Engineer", period: "", description: "<p>Built services.</p>" },
			],
		}),
	];
	data.customSections = [
		{
			id: "custom",
			type: "summary",
			title: "About",
			icon: "",
			columns: 1,
			hidden: false,
			keepTogether: false,
			startOnNewPage: false,
			items: [{ id: "about", hidden: false, content: "<p>Custom prose.</p>" }],
		},
	];
	const passages = collectPassages(data, {
		...labels,
		summary: "Summary",
		sectionTitle: (id) => id,
		entryTitle: () => "Kettle",
	});
	expect(passages.map((passage) => passage.text)).toEqual(["Led delivery.", "Built services.", "Custom prose."]);
	for (const passage of [passages[0], passages[2]]) {
		if (!passage) throw new Error("Missing supported passage");
		expect(
			applyProposal(data, {
				id: passage.id,
				target: passage.target,
				location: passage.location,
				before: passage.html,
				after: "<p>Revised.</p>",
				why: "Clearer",
				status: "pending",
				source: "check",
			}),
		).toBe(true);
		expect(readTarget(data, passage.target)).toBe("<p>Revised.</p>");
	}
	expect(data.sections.experience.items[0]?.roles[1]?.description).toBe("<p>Built services.</p>");
	expect(data.sections.experience.items[0]?.description).toBe("");
	const experience = data.sections.experience.items[0];
	const custom = data.customSections[0];
	if (!experience || !custom) throw new Error("Missing fixtures");
	experience.hidden = true;
	custom.hidden = true;
	expect(
		collectPassages(data, { ...labels, summary: "Summary", sectionTitle: (id) => id, entryTitle: () => "Kettle" }),
	).toEqual([]);
});

describe("additionAfter", () => {
	it("adds a paragraph after a paragraph, and nothing for a passage that's gone", () => {
		expect(additionAfter("<p>One</p><p>Two</p>", "<p>One</p>", "Between")).toEqual({
			before: "<p>One</p>",
			after: "<p>One</p><p>Between</p>",
		});
		expect(additionAfter("<p>One</p>", "<p>Gone</p>", "x")).toBeUndefined();
	});
});

describe("collectLetterPassages", () => {
	it("lists the body's paragraphs with stable ids that change with the text", () => {
		const passages = collectLetterPassages("<p>Hello there.</p><p>Hello there.</p><p>Bye.</p>", labels);

		expect(passages.map((passage) => passage.location)).toEqual([
			"Letter · paragraph 1",
			"Letter · paragraph 2",
			"Letter · paragraph 3",
		]);
		expect(passages[1]?.id).toBe(`${passages[0]?.id}_2`);
		expect(collectLetterPassages("<p>Hello, there.</p>", labels)[0]?.id).not.toBe(passages[0]?.id);
	});

	it("offers an empty body as one empty passage only when asked", () => {
		expect(collectLetterPassages("", labels)).toEqual([]);
		const [empty] = collectLetterPassages("", { ...labels, includeEmpty: true });
		expect(empty).toMatchObject({ html: "", text: "", location: "Letter" });
		// Writing into it replaces the empty text.
		expect(applyTo("", { before: "", after: "<p>Dear team</p>" })).toBe("<p>Dear team</p>");
	});
});

it("counts one real write for duplicate serializer-only proposals and marks normalized no-ops out of date", () => {
	let content = `<p>They've said "yes".</p>`;
	const before = content;
	const after = replaceBlockText(before, `They've said "yes".`);
	const first = { ...proposal(before, after), id: "first" };
	const second = { ...first, id: "second" };
	let writes = 0;
	const result = applyProposals(
		[first, second],
		() => content,
		(_, next) => {
			if (next !== content) writes++;
			content = next;
		},
	);
	expect(writes).toBe(1);
	expect(result.applied).toEqual([first]);
	expect(result.stale).toEqual([second]);
	expect(getStateIn(content, second)).toBe("stale");
	expect(applyTo(content, second)).toBeUndefined();
});

it("does not acknowledge a newer Undo/Redo decision with an older save response", () => {
	expect(acknowledgeProposalApplications({ edit: false, later: true }, { edit: true })).toEqual({
		edit: false,
		later: true,
	});
	expect(acknowledgeProposalApplications({ edit: false, later: true }, { edit: false })).toEqual({ later: true });
});

it("records only real structural writes, retains accepted identity after refinement, and requires explicit Undo", () => {
	const data = structuredClone(defaultResumeData);
	const before = resumeStructureSnapshot(data);
	const after = structuredClone(data);
	after.basics.headline = "Design lead";
	const edit: Proposal = {
		...proposal("Headline: —", "Headline: Design lead"),
		target: { sectionId: "resume", field: "data" },
		snapshot: { before, after: resumeStructureSnapshot(after) },
	};
	const unchanged: Proposal = { ...edit, id: "no-change", snapshot: { before, after: before } };
	expect(applyResumeProposals(data, [unchanged])).toEqual({ applied: [], stale: [unchanged] });
	expect(data.basics.headline).toBe("");
	expect(applyResumeProposals(data, [edit, edit])).toEqual({ applied: [edit], stale: [] });
	data.basics.headline = "Manually refined";
	const decisions = { [edit.id]: true };
	expect(getProposalState(data, edit, decisions)).toBe("accepted");
	expect(applyResumeProposals(data, [edit], decisions)).toEqual({ applied: [], stale: [] });
	const undone = structuredClone(defaultResumeData);
	expect(getProposalState(undone, { ...edit, status: "accepted" })).toBe("accepted");
	expect(getProposalState(undone, { ...edit, status: "accepted" }, { [edit.id]: false })).toBe("pending");
});

describe("review checks", () => {
	it.each([
		["AWS", "GCP"],
		["aws", "gcp"],
		["Aws", "Gcp"],
		["SQL", "QA"],
		["sql", "qa"],
		["iOS", "S3"],
		["ios", "s3"],
		["äx", "öy"],
	])("keeps short subjects case-independent when checking %s versus %s figures", (first, second) => {
		const entry = `Cut ${first} costs 40% in 2020. Cut ${second} costs 10% in 2023.`;
		expect(unverifiedClaims(`Cut ${second} costs 40% in 2020.`, { entry, document: entry })).toEqual(
			expect.arrayContaining([
				{ kind: "figure", text: "40%" },
				{ kind: "date", text: "2020" },
			]),
		);
		for (const original of [`Cut ${first} costs 40% in 2020.`, `Cut ${second} costs 10% in 2023.`])
			expect(unverifiedClaims(original, { entry, document: entry })).toEqual([]);
	});
	it("flags a reused number or a year that isn't this entry's, and words the document never uses", () => {
		const claims = unverifiedClaims("Cut costs by 40 dollars every month since 2023 using Kubernetes", {
			entry: "Studio Kettle. Managed 40 people. 2019 to 2021.",
			document: "Studio Kettle. Managed 40 people. 2019 to 2021. Other job: 2019 to 2023. Cut costs every month since",
		});
		expect(claims).toEqual([
			{ kind: "figure", text: "40 dollars" },
			{ kind: "date", text: "2023" },
			{ kind: "term", text: "by" },
			{ kind: "term", text: "dollars" },
			{ kind: "term", text: "using" },
			{ kind: "term", text: "Kubernetes" },
		]);
		// The entry's own claim, with its unit and year in one clause, passes.
		expect(
			unverifiedClaims("Managed 40 people from 2019", {
				entry: "Managed 40 people from 2019 to 2021",
				document: "Managed 40 people from 2019 to 2021",
			}),
		).toEqual([]);
	});

	it("flags a figure moved onto another dated claim in the same entry instead of treating it as backed", () => {
		const entry = "Reduced costs 40% in 2020. Improved delivery 10% in 2023.";
		expect(unverifiedClaims("Improved delivery 40% in 2023.", { entry, document: entry })).toEqual([
			{ kind: "figure", text: "40%" },
			{ kind: "date", text: "2023" },
		]);
		// Same numbers and year, different responsibility.
		expect(unverifiedClaims("Improved delivery 40% in 2020.", { entry, document: entry })).toEqual([
			{ kind: "figure", text: "40%" },
			{ kind: "date", text: "2020" },
		]);
		expect(unverifiedClaims("Cut costs 40% in 2020.", { entry, document: `${entry} Cut` })).toEqual([]);
		// A short name is the subject too: AWS's figure and year aren't GCP's.
		const clouds = "Cut AWS costs 40% in 2020; Cut GCP costs 10% in 2023";
		expect(unverifiedClaims("Cut GCP costs 40% in 2020", { entry: clouds, document: clouds })).toEqual([
			{ kind: "figure", text: "40%" },
			{ kind: "date", text: "2020" },
		]);
		expect(unverifiedClaims("Cut AWS costs 40% in 2020", { entry: clouds, document: clouds })).toEqual([]);
		expect(unverifiedClaims("Cut GCP costs 10% in 2023", { entry: clouds, document: clouds })).toEqual([]);
		// A verb two claims share doesn't make one claim's figure and year the other's.
		const shared = "Reduced costs 40% in 2020. Reduced delivery delays 10% in 2023.";
		expect(unverifiedClaims("Reduced delivery delays 40% in 2020.", { entry: shared, document: shared })).toEqual([
			{ kind: "figure", text: "40%" },
			{ kind: "date", text: "2020" },
		]);
	});

	it("checks a role's figures against that role only, one line per bullet", () => {
		const data = structuredClone(defaultResumeData);
		data.sections.experience.items = [
			experienceItemSchema.parse({
				id: "studio",
				hidden: false,
				company: "Studio Kettle",
				position: "",
				location: "",
				period: "",
				description: "",
				website: { url: "", label: "" },
				roles: [
					{
						id: "lead",
						position: "Lead",
						period: "2022",
						description: "<ul><li><p>Grew revenue 30%</p></li><li><p>Hired 4 people</p></li></ul>",
					},
					{ id: "junior", position: "Junior", period: "2019", description: "<p>Cut costs 50%</p>" },
				],
			}),
		];
		const lead = entryText(data, { sectionId: "experience", itemId: "studio", roleId: "lead", field: "description" });
		expect(lead).toContain("Grew revenue 30%\nHired 4 people");
		expect(lead).not.toContain("50%");
		expect(unverifiedClaims("Cut costs 50%", { entry: lead, document: lead })).toContainEqual({
			kind: "figure",
			text: "50%",
		});
	});

	it("rebuilds a rewrite from plain text and keeps only the flags still in it", () => {
		const replaced = withEditedText(
			{
				before: "<p>Old</p>",
				after: "<p>Led Kubernetes at Invented Corp</p>",
				unsupported: [
					{ kind: "skill", text: "Kubernetes" },
					{ kind: "employer", text: "Invented Corp" },
				],
			},
			"Led <b>platform</b> work at Invented Corp",
		);
		expect(replaced.after).toBe("<p>Led &lt;b&gt;platform&lt;/b&gt; work at Invented Corp</p>");
		expect(replaced.unsupported).toEqual([{ kind: "employer", text: "Invented Corp" }]);
		expect(replaced.edited).toBe(true);

		const added = withEditedText(
			{ before: "<p>Ran sessions</p></li>", after: "<p>Ran sessions</p></li><li><p>Added</p></li>", unsupported: [] },
			"Mine",
		);
		expect(added.after).toBe("<p>Ran sessions</p></li><li><p>Mine</p></li>");
	});
});

describe("additionParts and passageLines", () => {
	it("reads an addition as its anchor and the new blocks, one line each", () => {
		const before = "<p>Improved checkout-flow accessibility.</p></li>";
		expect(
			additionParts({ before, after: `${before}<li><p>Led an audit.</p></li><li><p>Fixed 60 issues.</p></li>` }),
		).toEqual({ anchor: "Improved checkout-flow accessibility.", added: "Led an audit.\nFixed 60 issues." });
	});

	it("is undefined for rewrites, new text in an empty field and structural changes", () => {
		expect(additionParts({ before: "<p>Old</p>", after: "<p>New</p>" })).toBeUndefined();
		expect(additionParts({ before: "", after: "<p>New</p>" })).toBeUndefined();
		expect(
			additionParts({ before: "<p>A</p>", after: "<p>A</p><p>B</p>", snapshot: { before: "", after: "" } }),
		).toBeUndefined();
	});

	it("keeps one passage on one line", () => {
		expect(passageLines("<p>One &amp; only</p>")).toBe("One & only");
	});
});
