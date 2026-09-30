import { assert, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { produce } from "immer";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { getCompatibleMoveTargets, getSourceSectionTitle, moveItem } from "./move-item";

const company = (id: string) => ({
	id,
	hidden: false,
	company: `Company ${id}`,
	position: `Position ${id}`,
	location: "",
	period: "",
	description: "",
	roles: [],
	website: { url: "", label: "", inlineLink: false },
});
const base = () =>
	produce(defaultResumeData, (draft) => {
		draft.sections.experience.items = [company("1"), company("2")];
		draft.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: [] }];
	});
const split = () =>
	produce(base(), (draft) => {
		moveItem(draft, { itemId: "2", type: "experience", target: { type: "new-page", title: "Experience" } });
	});

describe("moving the last custom-section item (#3180)", () => {
	it("labels blank custom move destinations with their section type", () => {
		i18n.load("en", {});
		i18n.activate("en");
		const moved = produce(split(), (draft) => {
			const section = draft.customSections[0];
			if (!section) throw new Error("Missing custom section fixture");
			section.title = " ";
		});
		const targets = getCompatibleMoveTargets(moved, "experience", undefined);
		expect(targets.find((page) => page.pageIndex === 1)?.sections[0]?.sectionTitle).toBe("Experience");
		expect(getSourceSectionTitle(moved, "experience", moved.customSections[0]?.id)).toBe("Experience");
	});
	it("restores the original JSON after moving an experience item to a new page and back", () => {
		const initial = base();
		const moved = split();
		const section = moved.customSections[0];
		assert.exists(section);
		expect(moved.metadata.layout.pages).toHaveLength(2);
		const restored = produce(moved, (draft) => {
			moveItem(draft, {
				itemId: "2",
				type: "experience",
				customSectionId: section.id,
				target: { type: "section", sectionId: "experience" },
			});
		});
		expect(restored).toEqual(initial);
	});
	it("preserves unrelated blank pages and pages with other section references", () => {
		const moved = produce(split(), (draft) => {
			draft.metadata.layout.pages.push({ fullWidth: true, main: [], sidebar: [] });
			assert.exists(draft.metadata.layout.pages[1]);
			draft.metadata.layout.pages[1].sidebar.push("skills");
		});
		const section = moved.customSections[0];
		assert.exists(section);
		const restored = produce(moved, (draft) => {
			moveItem(draft, {
				itemId: "2",
				type: "experience",
				customSectionId: section.id,
				target: { type: "section", sectionId: "experience" },
			});
		});
		expect(restored.customSections).toEqual([]);
		expect(restored.metadata.layout.pages).toEqual([
			{ fullWidth: false, main: ["experience"], sidebar: [] },
			{ fullWidth: false, main: [], sidebar: ["skills"] },
			{ fullWidth: true, main: [], sidebar: [] },
		]);
	});
	it("preserves the first page when its only custom section becomes empty", () => {
		const moved = produce(split(), (draft) => {
			draft.metadata.layout.pages.reverse();
		});
		const section = moved.customSections[0];
		assert.exists(section);
		const restored = produce(moved, (draft) => {
			moveItem(draft, {
				itemId: "2",
				type: "experience",
				customSectionId: section.id,
				target: { type: "section", sectionId: "experience" },
			});
		});
		expect(restored.metadata.layout.pages).toEqual([
			{ fullWidth: false, main: [], sidebar: [] },
			{ fullWidth: false, main: ["experience"], sidebar: [] },
		]);
	});
	it("inserts into the selected later page before pruning the source page", () => {
		const moved = produce(split(), (draft) => {
			draft.metadata.layout.pages.push({ fullWidth: true, main: [], sidebar: ["skills"] });
		});
		const section = moved.customSections[0];
		assert.exists(section);
		const restored = produce(moved, (draft) => {
			moveItem(draft, {
				itemId: "2",
				type: "experience",
				customSectionId: section.id,
				target: { type: "new-section", pageIndex: 2, title: "Later" },
			});
		});
		expect(restored.metadata.layout.pages).toHaveLength(2);
		expect(restored.customSections).toHaveLength(1);
		assert.exists(restored.customSections[0]);
		expect(restored.customSections[0]).toMatchObject({ title: "Later", items: [company("2")] });
		expect(restored.metadata.layout.pages[1]).toEqual({
			fullWidth: true,
			main: [restored.customSections[0].id],
			sidebar: ["skills"],
		});
	});
	it("keeps a custom section with hidden remaining items", () => {
		const moved = produce(split(), (draft) => {
			assert.exists(draft.customSections[0]);
			draft.customSections[0].items.push({ ...company("3"), hidden: true });
		});
		const section = moved.customSections[0];
		assert.exists(section);
		const restored = produce(moved, (draft) => {
			moveItem(draft, {
				itemId: "2",
				type: "experience",
				customSectionId: section.id,
				target: { type: "section", sectionId: "experience" },
			});
		});
		assert.exists(restored.customSections[0]);
		expect(restored.customSections[0].items).toEqual([{ ...company("3"), hidden: true }]);
		expect(restored.metadata.layout.pages).toHaveLength(2);
	});
	it.each([
		{ type: "section", sectionId: "missing" },
		{ type: "section", sectionId: "skills" },
		{ type: "new-section", pageIndex: 99, title: "Missing" },
	] as const)("leaves data intact for an invalid destination $type", (target) => {
		const moved = split();
		const section = moved.customSections[0];
		assert.exists(section);
		expect(
			produce(moved, (draft) => {
				moveItem(draft, { itemId: "2", type: "experience", customSectionId: section.id, target });
			}),
		).toEqual(moved);
	});
});
