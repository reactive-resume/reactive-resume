import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vite-plus/test";
import { produce } from "immer";
import { customSectionItemDefinitionByType } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	addBuiltinSection,
	CUSTOM_SECTION_TYPES,
	countEntriesToCheck,
	createEntry,
	getOutlineRows,
	isSectionHidden,
	moveSection,
} from "./model";

const resume = (edit?: (data: ResumeData) => void) => {
	const data = structuredClone(defaultResumeData);
	data.metadata.layout.pages = [
		{ fullWidth: false, main: ["summary", "experience", "education"], sidebar: ["skills"] },
	];
	edit?.(data);
	return data;
};

const withEntries = (data: ResumeData, ...types: ("experience" | "education" | "skills")[]) => {
	for (const type of types) {
		const entry = createEntry(type) as { name?: string; company?: string; school?: string };
		if (type === "experience") entry.company = "Lumen";
		if (type === "education") entry.school = "UdK";
		if (type === "skills") entry.name = "Figma";
		(data.sections[type].items as unknown[]).push(entry);
	}
};

describe("createEntry", () => {
	it.each(CUSTOM_SECTION_TYPES)("makes a %s entry the schema accepts", (type) => {
		const entry = createEntry(type);
		expect(customSectionItemDefinitionByType[type].schema.safeParse(entry).success).toBe(true);
	});
});

describe("outline", () => {
	it("moves a section before a row when moving up and after it when moving down", () => {
		const data = resume((draft) => withEntries(draft, "experience", "education", "skills"));
		const up = produce(data, (draft) =>
			moveSection(draft, "education", { id: "experience", page: 0, column: "main" }, "up"),
		);
		expect(up.metadata.layout.pages[0]?.main).toEqual(["summary", "education", "experience"]);

		const down = produce(data, (draft) =>
			moveSection(draft, "experience", { id: "education", page: 0, column: "main" }, "down"),
		);
		expect(down.metadata.layout.pages[0]?.main).toEqual(["summary", "education", "experience"]);
	});

	it("changes column when a section moves across the sidebar divider", () => {
		const data = resume((draft) => withEntries(draft, "experience", "skills"));
		const moved = produce(data, (draft) =>
			moveSection(draft, "skills", { id: "experience", page: 0, column: "main" }, "up"),
		);
		expect(moved.metadata.layout.pages[0]).toMatchObject({
			main: ["summary", "skills", "experience", "education"],
			sidebar: [],
		});
	});
});

describe("hidden sections", () => {
	it("marks hidden sections in the outline instead of dropping them", () => {
		const data = resume((draft) => withEntries(draft, "experience", "education"));
		data.sections.experience.hidden = true;

		const rows = getOutlineRows(data);
		expect(rows.find((row) => row.id === "experience")).toMatchObject({ hidden: true });
		expect(rows.find((row) => row.id === "education")).toMatchObject({ hidden: false });
	});

	it("reads the hidden flag of every kind of section", () => {
		const data = resume((draft) => withEntries(draft, "experience"));
		expect(isSectionHidden(data, "summary")).toBe(false);
		expect(isSectionHidden(data, "experience")).toBe(false);
		expect(isSectionHidden(data, "missing")).toBe(false);

		data.summary.hidden = true;
		data.sections.experience.hidden = true;
		expect(isSectionHidden(data, "summary")).toBe(true);
		expect(isSectionHidden(data, "experience")).toBe(true);
	});
});

describe("date review badges", () => {
	it("counts unreadable entries and nested roles but not readable or empty custom text", () => {
		const data = resume();
		withEntries(data, "experience", "experience", "experience", "experience");
		const [readable, blank, unreadable, nested] = data.sections.experience.items;
		if (!readable || !blank || !unreadable || !nested) throw new Error("Missing entries");
		readable.dates = { start: "2022-03", end: null, present: true, raw: "March 2022 - Present" };
		blank.dates = { start: null, end: null, present: false, raw: "" };
		unreadable.dates = { start: null, end: null, present: false, raw: "During university" };
		nested.roles = [
			{ id: "role", position: "Lead", description: "", period: "During university", dates: unreadable.dates },
		];
		expect(countEntriesToCheck(data.sections.experience.items)).toBe(2);
	});
});

describe("addBuiltinSection", () => {
	const blank = () => {
		const data = structuredClone(defaultResumeData);
		data.metadata.layout.pages = [{ fullWidth: false, main: ["experience", "education"], sidebar: [] }];
		return data;
	};
	const mainOf = (data: ResumeData) => data.metadata.layout.pages[0]?.main;

	it("prints Education above Experience when a student starts with it", () => {
		const data = produce(blank(), (draft) => void addBuiltinSection(draft, "education"));
		expect(mainOf(data)).toEqual(["education", "experience"]);
	});

	it("leaves the order alone once the other section has entries", () => {
		const started = produce(blank(), (draft) => void addBuiltinSection(draft, "experience"));
		const data = produce(started, (draft) => void addBuiltinSection(draft, "education"));
		expect(mainOf(data)).toEqual(["experience", "education"]);
	});
});
