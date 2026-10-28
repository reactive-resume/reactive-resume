import type { SemanticNode } from "./types";
import { describe, expect, it } from "vite-plus/test";
import { compileStylesheet } from "./compile";
import { compileSelector, createSelectorMatcher } from "./selector";

const experienceId = "229ad766-cb9a-4f16-aaf0-fdd8394a9b95";

const node = (
	key: string,
	kind: SemanticNode["kind"],
	options: Partial<Omit<SemanticNode, "key" | "kind">> = {},
): SemanticNode =>
	Object.freeze({
		key,
		kind,
		attributes: Object.freeze(options.attributes ?? {}),
		roles: Object.freeze(options.roles ?? []),
		children: Object.freeze(options.children ?? []),
		...(options.id ? { id: options.id } : {}),
	});

const itemFirst = node("item-first", "item", { roles: ["experience-role"] });
const itemSecond = node("item-second", "item", { roles: ["experience-role", "nested-role"] });
const itemThird = node("item-third", "item", { roles: ["experience-role"] });
const experience = node("section-experience", "section", {
	id: experienceId,
	attributes: { type: "experience", placement: "main", origin: "custom-import" },
	children: [
		node("heading-experience", "section-heading", { roles: ["section-title"] }),
		node("items-experience", "section-items", { children: [itemFirst, itemSecond, itemThird] }),
	],
});
const education = node("section-education", "section", {
	id: "1abc",
	attributes: { type: "education", placement: "main", origin: "native" },
});
const fixtureTree = node("resume", "resume", {
	attributes: { template: "rhyhorn" },
	children: [
		node("page-1", "page", {
			attributes: { "page-number": "1" },
			children: [
				node("region-main", "region", {
					attributes: { placement: "main", region: "body" },
					children: [experience, education],
				}),
				node("region-sidebar", "region", {
					attributes: { placement: "sidebar", region: "body" },
					children: [
						node("section-skills-sidebar", "section", {
							attributes: { type: "skills", placement: "sidebar", origin: "native" },
						}),
					],
				}),
			],
		}),
	],
});

const selectorMatches = createSelectorMatcher(fixtureTree);

function matches(source: string, nodeKey: string): boolean {
	const result = compileSelector(source);
	return result.selector ? selectorMatches(result.selector, nodeKey) : false;
}

describe("semantic selector compilation", () => {
	it("bounds repeated general-sibling failures without losing later matches", () => {
		const children = Array.from({ length: 200 }, (_, index) => node(`item-${index}`, "item"));
		const match = createSelectorMatcher(node("root", "resume", { children }));
		for (const prefix of ["section", "item"]) {
			const selector = compileSelector(`${prefix}${" ~ item".repeat(12)}`).selector;
			if (!selector) throw new Error("Invalid fixture selector");
			for (let index = 0; index < children.length; index++) {
				expect(match(selector, `item-${index}`)).toBe(prefix === "item" && index >= 12);
			}
		}
	});

	it.each([
		['section[type="experience"] > section-heading', "heading-experience", true],
		['region[placement="sidebar"] section', "section-skills-sidebar", true],
		['section:is([type="experience"], [type="education"])', "section-education", true],
		["item:nth-child(2)", "item-second", true],
		["section, item:nth-child(2)", "item-second", true],
		["* > page", "page-1", true],
		['section[type="experience"] + section', "section-education", true],
		['section[type="experience"] ~ section', "section-education", true],
		[":root > page", "page-1", true],
		['section:not([type="education"])', "section-experience", true],
		['section:where([type="education"])', "section-education", true],
		["section:is(:where([type='education']))", "section-education", true],
		["item:first-child", "item-first", true],
		["item:last-child", "item-third", true],
		["section:only-child", "section-skills-sidebar", true],
		["item:nth-child(2n + 1)", "item-third", true],
		["item:nth-of-type(even)", "item-second", true],
	])("matches %s against the immutable semantic tree", (selector, nodeKey, expected) => {
		expect(matches(selector, nodeKey)).toBe(expected);
	});

	it("reflects IDs, roles, and lowercase registry attributes with case-sensitive values", () => {
		expect(matches(`#${experienceId}`, "section-experience")).toBe(true);
		expect(matches(`[id="${experienceId}"]`, "section-experience")).toBe(true);
		expect(matches("#\\31 abc", "section-education")).toBe(true);
		expect(matches("sect\\69 on[\\74 ype='experience']", "section-experience")).toBe(true);
		expect(matches("[role~='nested-role']", "item-second")).toBe(true);
		expect(matches('[type="Experience"]', "section-experience")).toBe(false);
		expect(matches('[TYPE="experience"]', "section-experience")).toBe(false);
	});

	it("implements every supported attribute operator", () => {
		expect(matches("[type]", "section-experience")).toBe(true);
		expect(matches('[type="experience"]', "section-experience")).toBe(true);
		expect(matches('[role~="nested-role"]', "item-second")).toBe(true);
		expect(matches('[type^="exp"]', "section-experience")).toBe(true);
		expect(matches('[type*="per"]', "section-experience")).toBe(true);
	});

	it.each([
		".custom",
		"section::before",
		"section:hover",
		"unknown-element",
		"[unknown]",
		'[role~="unknown-role"]',
		'section[role~="primary-text"]',
		"page[type]",
		'[type="experience" i]',
	])("rejects unsupported or unknown selector %s", (selector) => {
		expect(compileSelector(selector).selector).toBeNull();
	});

	it("enforces selector resource limits", () => {
		expect(compileSelector(new Array(66).fill("section").join(",")).selector).toBeNull();
		expect(compileSelector(new Array(19).fill("resume").join(" > ")).selector).toBeNull();
		expect(compileSelector(`${" ".repeat(2_042)}section`).selector).toBeNull();
		expect(compileSelector(`${"😀".repeat(2_042)}section`).selector).toBeNull();
		expect(compileSelector(`${":is(".repeat(17)}section${")".repeat(17)}`).selector).toBeNull();
	});

	it("treats selector-count overflow as a fatal resource limit", () => {
		const selectors = new Array(65).fill("section").join(",");
		const result = compileStylesheet({ languageVersion: 1, text: `@version 1;\n${selectors} { color: red; }` });

		expect(result.program).toBeNull();
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_LIMIT", severity: "error" }));
		expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "INVALID_SELECTOR" }));
	});
});
