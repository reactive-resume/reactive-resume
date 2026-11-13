import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { sortEntriesByDate } from "./model";

test("sorts publications newest first and names entries with unreadable dates by title", () => {
	const data = structuredClone(sampleResumeData);
	const entries = data.sections.publications.items;
	const first = entries[0];
	if (!first) throw new Error("Missing sample publication");
	const undated = structuredClone(first);
	undated.id = "undated";
	undated.title = "Forthcoming paper";
	undated.date = "";
	delete undated.dates;
	entries.push(undated);

	const unresolved = sortEntriesByDate(
		data,
		{ id: "publications", kind: "builtin", type: "publications" },
		data.metadata.page.locale,
	);

	expect(entries.map((entry) => entry.title)).toEqual([
		"Building Modular Dialogue Systems",
		"Optimizing Unity Games for Mobile: A Practical Guide",
		"Forthcoming paper",
	]);
	expect(unresolved).toEqual(["Forthcoming paper"]);
});

test("names undated experience entries by company", () => {
	const data = structuredClone(sampleResumeData);
	const entries = data.sections.experience.items;
	for (const entry of entries) {
		entry.period = "";
		entry.dates = { start: null, end: null, present: false };
	}

	const unresolved = sortEntriesByDate(
		data,
		{ id: "experience", kind: "builtin", type: "experience" },
		data.metadata.page.locale,
	);

	expect(unresolved).toEqual(entries.map((entry) => entry.company));
});

test("sorts custom publications without changing built-in entries and falls back to ids for blank titles", () => {
	const data = structuredClone(sampleResumeData);
	const [first] = data.sections.publications.items;
	if (!first) throw new Error("Missing sample publication");
	const custom = {
		...data.sections.publications,
		id: "custom-publications",
		type: "publications" as const,
		items: [
			{ ...first, id: "undated", title: "   ", date: "", dates: undefined },
			{ ...first, id: "dated", date: "2025", dates: undefined },
		],
	};
	data.customSections.push(custom);
	const builtin = structuredClone(data.sections.publications.items);

	const unresolved = sortEntriesByDate(data, { id: custom.id, kind: "custom", type: "publications" }, "en-US");

	expect(custom.items.map((entry) => entry.id)).toEqual(["dated", "undated"]);
	expect(unresolved).toEqual(["undated"]);
	expect(data.sections.publications.items).toEqual(builtin);
});
