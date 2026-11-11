import type { BaseSettingsSnapshot, ResolvedNodeStyle, ResolveStylesheetContext, SemanticNode } from "./types";
import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { resolveStylesheet } from "./cascade";
import { compileStylesheet } from "./compile";
import { SEMANTIC_CSS_LIMITS_V1 } from "./limits";

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

const items = node("items-experience", "section-items", {
	children: [node("item-1", "item"), node("item-2", "item"), node("item-3", "item")],
});
const tree = node("resume", "resume", {
	attributes: { template: "onyx" },
	children: [
		node("page-1", "page", {
			attributes: { "page-number": "1" },
			children: [
				node("region-main", "region", {
					attributes: { placement: "main", region: "body" },
					children: [
						node("section-experience", "section", {
							id: "experience",
							attributes: { type: "experience", placement: "main", origin: "native" },
							children: [node("heading-experience", "section-heading", { roles: ["section-title"] }), items],
						}),
					],
				}),
			],
		}),
	],
});

const baseSettings: BaseSettingsSnapshot = {
	picture: defaultResumeData.picture,
	template: defaultResumeData.metadata.template,
	design: defaultResumeData.metadata.design,
	typography: defaultResumeData.metadata.typography,
	page: defaultResumeData.metadata.page,
	layout: { sidebarWidth: defaultResumeData.metadata.layout.sidebarWidth },
};

const blankStyle: ResolvedNodeStyle = { style: {}, structural: {}, hidden: false, order: 0 };
const context: ResolveStylesheetContext = {
	baseStyles: {
		resume: blankStyle,
		"heading-experience": { ...blankStyle, style: { color: "black" } },
	},
	baseSettings,
	pages: [{ pageKey: "page-1", width: 595.28, height: 841.89 }],
};

function resolve(source: string, customContext: ResolveStylesheetContext = context) {
	const compiled = compileStylesheet({ languageVersion: 1, text: `@version 1;${source}` });
	if (!compiled.program) throw new Error(compiled.diagnostics.map(({ code }) => code).join(","));
	return resolveStylesheet(compiled.program, tree, customContext);
}

function resolveTree(source: string, semanticTree: SemanticNode, customContext: ResolveStylesheetContext) {
	const compiled = compileStylesheet({ languageVersion: 1, text: `@version 1;${source}` });
	if (!compiled.program) throw new Error(compiled.diagnostics.map(({ code }) => code).join(","));
	return resolveStylesheet(compiled.program, semanticTree, customContext);
}

function find(nodeToSearch: SemanticNode, key: string): SemanticNode | undefined {
	if (nodeToSearch.key === key) return nodeToSearch;
	for (const child of nodeToSearch.children) {
		const match = find(child, key);
		if (match) return match;
	}
}

function semanticTreeOfSize(size: number, shape: "deep" | "wide"): SemanticNode {
	if (shape === "wide") {
		return node("root", "resume", {
			children: Array.from({ length: size - 1 }, (_, index) => node(`item-${index}`, "item")),
		});
	}

	let root = node("node-0", "item");
	for (let index = 1; index < size; index++) root = node(`node-${index}`, "item", { children: [root] });
	return root;
}

describe("Semantic CSS cascade and structural resolution", () => {
	it("resolves two-number flex as grow and shrink with an implicit basis", () => {
		const result = resolve("item { flex: 2 3; }");

		expect(result.nodes["item-1"]?.style).toMatchObject({
			"flex-grow": 2,
			"flex-shrink": 3,
			"flex-basis": "0%",
		});
	});

	it("resolves base, normal and important rules by specificity then source order", () => {
		const result = resolve(`
			section-heading { color: red; }
			section[type="experience"] > section-heading { color: blue !important; }
			section#experience > section-heading { color: green; }
		`);

		expect(result.nodes["heading-experience"]?.style.color).toBe("blue");
	});

	it("cascades canonical and alias identities before choosing one winner", () => {
		const contactTree = node("resume", "resume", {
			children: [
				node("page-1", "page", {
					attributes: { "page-number": "1" },
					children: [
						node("contact-list", "contact-list", {
							children: [
								node("contact-email", "contact-item", {
									attributes: { name: "email" },
									roles: ["structured-link"],
									children: [node("contact-email-link", "link", { roles: ["structured-link"] })],
								}),
							],
						}),
					],
				}),
			],
		});
		const aliasContext = {
			...context,
			baseStyles: {},
			aliases: { "contact-email": ["contact-email-link"] },
		} satisfies ResolveStylesheetContext;

		const laterAlias = resolveTree("contact-item { color: red; } link { color: blue; }", contactTree, aliasContext);
		const laterCanonical = resolveTree("link { color: blue; } contact-item { color: red; }", contactTree, aliasContext);
		const specificCanonical = resolveTree(
			"contact-item[name='email'] { color: red; } link { color: blue; }",
			contactTree,
			aliasContext,
		);
		const importantAlias = resolveTree(
			"contact-item[name='email'] { color: red; } link { color: blue !important; }",
			contactTree,
			aliasContext,
		);

		expect(laterAlias.nodes["contact-email"]?.style.color).toBe("blue");
		expect(laterCanonical.nodes["contact-email"]?.style.color).toBe("red");
		expect(specificCanonical.nodes["contact-email"]?.style.color).toBe("red");
		expect(importantAlias.nodes["contact-email"]?.style.color).toBe("blue");
	});

	it("applies alias display and order state to the canonical render owner", () => {
		const contactTree = node("resume", "resume", {
			children: [
				node("page-1", "page", {
					attributes: { "page-number": "1" },
					children: [
						node("contact-list", "contact-list", {
							children: [
								node("contact-phone", "contact-item", {
									attributes: { name: "phone" },
									roles: ["structured-link"],
									children: [node("contact-phone-link", "link", { roles: ["structured-link"] })],
								}),
								node("contact-email", "contact-item", {
									attributes: { name: "email" },
									roles: ["structured-link"],
									children: [node("contact-email-link", "link", { roles: ["structured-link"] })],
								}),
							],
						}),
					],
				}),
			],
		});
		const aliasContext = {
			...context,
			baseStyles: {},
			aliases: {
				"contact-email": ["contact-email-link"],
				"contact-phone": ["contact-phone-link"],
			},
		} satisfies ResolveStylesheetContext;
		const ordered = resolveTree("contact-item[name='email'] > link { order: -1; }", contactTree, aliasContext);
		const hidden = resolveTree("contact-item[name='email'] > link { display: none; }", contactTree, aliasContext);

		expect(find(ordered.renderTree, "contact-list")?.children.map(({ key }) => key)).toEqual([
			"contact-email",
			"contact-phone",
		]);
		expect(find(hidden.renderTree, "contact-list")?.children.map(({ key }) => key)).toEqual(["contact-phone"]);
		expect(hidden.nodes["contact-email"]?.hidden).toBe(true);
	});

	it("resolves inherited custom properties, fallbacks, cycles, and CSS-wide keywords", () => {
		const valid = resolve(`
			:root { --accent: var(--resume-primary-color); color: red; }
			section { color: inherit; }
			section-heading { color: var(--missing, var(--accent)); }
		`);
		expect(valid.nodes["heading-experience"]?.style.color).toBe(baseSettings.design.colors.primary);

		const compiled = compileStylesheet({
			languageVersion: 1,
			text: "@version 1; :root { --a: var(--b); --b: var(--a); } section { color: var(--a); }",
		});
		if (!compiled.program) throw new Error(compiled.diagnostics.map(({ code }) => code).join(","));
		const cycled = resolveStylesheet(compiled.program, tree, context);
		expect(cycled.nodes["heading-experience"]?.style.color).toBe("black");
		expect(cycled.diagnostics).toContainEqual(expect.objectContaining({ code: "VARIABLE_CYCLE", severity: "error" }));
	});

	it("normalizes PDF lengths with the correct font-relative bases and expands spacing shorthands", () => {
		const result = resolve(`
			section-heading { font-size: 2em; margin: 96px 1em 1in 25.4mm; padding: 1rem 2cm; }
		`);

		expect(result.nodes["heading-experience"]?.style).toMatchObject({
			"font-size": 20,
			"margin-top": 72,
			"margin-right": 20,
			"margin-bottom": 72,
			"margin-left": 72,
			"padding-top": 10,
			"padding-right": 56.69291338582677,
			"padding-bottom": 10,
			"padding-left": 56.69291338582677,
		});
	});

	it("resolves variables before expanding multi-token shorthands", () => {
		const result = resolve(`
			:root {
				--space: 1pt 2pt 3pt 4pt;
				--edge: 2pt solid red;
				--gaps: 5pt 6pt;
				--flex: 2 3 25%;
			}
			section {
				margin: var(--space);
				padding: var(--space);
				border: var(--edge);
				gap: var(--gaps);
				flex: var(--flex);
			}
		`);

		expect(result.nodes["section-experience"]?.style).toMatchObject({
			"margin-top": 1,
			"margin-right": 2,
			"margin-bottom": 3,
			"margin-left": 4,
			"padding-top": 1,
			"padding-right": 2,
			"padding-bottom": 3,
			"padding-left": 4,
			"border-top-width": 2,
			"border-top-style": "solid",
			"border-top-color": "red",
			"row-gap": 5,
			"column-gap": 6,
			"flex-grow": 2,
			"flex-shrink": 3,
			"flex-basis": "25%",
		});
	});

	it("rejects property names inherited from Object.prototype instead of crashing", () => {
		const compiled = compileStylesheet({ languageVersion: 1, text: "@version 1;item { constructor: red; }" });

		expect(compiled.diagnostics).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_PROPERTY" }));
	});

	it("keeps valid resolved declarations when a neighboring value is invalid", () => {
		const result = resolve("section-heading { color: red; opacity: var(--missing); }");

		expect(result.nodes["heading-experience"]?.style.color).toBe("red");
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "UNRESOLVED_VARIABLE", severity: "error" }),
		);
	});

	it("resolves authored size before media and rejects size inside media", () => {
		const result = resolve(
			`
				page { size: 400pt 600pt; padding-top: var(--resume-page-width); }
				@media (min-width: 390pt) and (orientation: portrait) { page { margin-top: 10pt; } }
			`,
			{ ...context, pages: [{ pageKey: "page-1", width: 800, height: 400 }] },
		);
		expect(result.nodes["page-1"]?.structural.pageSize).toEqual({ width: 400, height: 600 });
		expect(result.nodes["page-1"]?.style["margin-top"]).toBe(10);
		expect(result.nodes["page-1"]?.style["padding-top"]).toBe(400);

		const invalid = compileStylesheet({
			languageVersion: 1,
			text: "@version 1; @media (width: 400pt) { page { size: A4; } }",
		});
		expect(invalid.program).not.toBeNull();
		expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: "MEDIA_PAGE_SIZE", severity: "error" }));
	});

	it.each([3, 4])("bounds %i-way branching variable expansion by aggregate work and output", (branches) => {
		const depth = Math.ceil(Math.log(SEMANTIC_CSS_LIMITS_V1.maxSourceBytes) / Math.log(branches)) + 1;
		const variables = Array.from({ length: depth }, (_, index) => {
			const next = index === depth - 1 ? "r" : Array.from({ length: branches }, () => `var(--v${index + 1})`).join("");
			return `--v${index}:${next};`;
		}).join("");
		const compiled = compileStylesheet({
			languageVersion: 1,
			text: `@version 1;:root{${variables}}section-heading{color:var(--v0);}`,
		});
		if (!compiled.program) throw new Error(compiled.diagnostics.map(({ code }) => code).join(","));
		const result = resolveStylesheet(compiled.program, tree, context);
		expect(result.nodes).toEqual({});
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_LIMIT", severity: "error" }));
	});

	it.each([
		{ keyword: "InItIaL", color: undefined, hidden: false, order: 0, fixed: undefined, breakBefore: undefined },
		{ keyword: "InHeRiT", color: "purple", hidden: true, order: 3, fixed: true, breakBefore: "page" },
	] as const)(
		"applies case-insensitive $keyword semantics to style, hidden, order, and structural properties",
		({ keyword, color, hidden, order, fixed, breakBefore }) => {
			const customContext: ResolveStylesheetContext = {
				...context,
				baseStyles: {
					...context.baseStyles,
					resume: {
						style: {},
						structural: { fixed: true, breakBefore: "page" },
						hidden: true,
						order: 3,
					},
					"region-main": {
						style: { color: "purple" },
						structural: { fixed: true, breakBefore: "page" },
						hidden: true,
						order: 3,
					},
					"section-experience": {
						style: { color: "navy" },
						structural: { fixed: true, breakBefore: "page" },
						hidden: true,
						order: 7,
					},
				},
			};
			const result = resolve(
				`section { color: ${keyword}; display: ${keyword}; order: ${keyword}; -resume-fixed: ${keyword}; break-before: ${keyword}; }`,
				customContext,
			);

			expect(result.nodes["section-experience"]).toMatchObject({ hidden, order });
			expect(result.nodes["section-experience"]?.style.color).toBe(color);
			expect(result.nodes["section-experience"]?.structural.fixed).toBe(fixed);
			expect(result.nodes["section-experience"]?.structural.breakBefore).toBe(breakBefore);
		},
	);

	it("normalizes supported line-height lengths and enforces font-size and opacity bounds", () => {
		const valid = resolve("section-heading { line-height: 12pt; font-size: 0; opacity: 0; }");
		expect(valid.nodes["heading-experience"]?.style).toMatchObject({
			"line-height": "12pt",
			"font-size": 0,
			opacity: 0,
		});
		const upper = resolve("section-heading { opacity: 1; }");
		expect(upper.nodes["heading-experience"]?.style.opacity).toBe(1);

		for (const declaration of ["font-size: -0.01pt", "opacity: -0.0001", "opacity: 1.0001"]) {
			const compiled = compileStylesheet({
				languageVersion: 1,
				text: `@version 1;section-heading{${declaration}}`,
			});
			expect(compiled.program, declaration).not.toBeNull();
			expect(compiled.diagnostics, declaration).toContainEqual(
				expect.objectContaining({ code: "INVALID_VALUE", severity: "error" }),
			);
		}

		const variable = resolve(":root { --bad: 1.0001; } section-heading { opacity: var(--bad); }");
		expect(variable.nodes["heading-experience"]?.style.color).toBe("black");
		expect(variable.diagnostics).toContainEqual(expect.objectContaining({ code: "INVALID_VALUE", severity: "error" }));
	});

	it("keeps line-height multiples as numbers and lengths as lengths", () => {
		const lineHeight = (value: string) =>
			resolve(`section-heading { line-height: ${value}; }`).nodes["heading-experience"]?.style["line-height"];

		expect(lineHeight("1.5")).toBe(1.5);
		expect(lineHeight("12pt")).toBe("12pt");
		expect(lineHeight("16px")).toBe("12pt");
		expect(lineHeight("1.5rem")).toBe("15pt");
		expect(lineHeight("1.2em")).toBe(1.2);
		expect(lineHeight("150%")).toBe(1.5);
		expect(lineHeight("normal")).toBe("normal");
	});

	it("inherits a line-height length unchanged by a child with another font size", () => {
		const richTree = node("resume", "resume", {
			children: [
				node("page-1", "page", {
					attributes: { "page-number": "1" },
					children: [node("paragraph-1", "paragraph", { children: [node("strong-1", "strong")] })],
				}),
			],
		});
		const result = resolveTree("paragraph { line-height: 18pt; } strong { font-size: 20pt; }", richTree, {
			...context,
			baseStyles: {},
		});

		expect(result.nodes["paragraph-1"]?.style["line-height"]).toBe("18pt");
		expect(result.nodes["strong-1"]?.style["line-height"]).toBe("18pt");
	});

	it("matches positional selectors before applying display and stable order exactly once", () => {
		const result = resolve(`
			item:nth-child(2) { display: none; }
			item:last-child { order: -1; }
		`);
		const renderedItems = find(result.renderTree, "items-experience");

		expect(renderedItems?.children.map(({ key }) => key)).toEqual(["item-3", "item-1"]);
		expect(tree.children[0]?.children[0]?.children[0]?.children[1]?.children.map(({ key }) => key)).toEqual([
			"item-1",
			"item-2",
			"item-3",
		]);
	});

	it("maps structural declarations without mixing them into renderer styles", () => {
		const result = resolve(`
			section { break-before: page; break-inside: avoid; -resume-fixed: true; -resume-min-presence-ahead: 12pt; }
			section-heading { orphans: 2; widows: 3; order: 4; }
		`);

		expect(result.nodes["section-experience"]).toMatchObject({
			structural: { breakBefore: "page", breakInside: "avoid", fixed: true, minPresenceAhead: 12 },
		});
		expect(result.nodes["heading-experience"]).toMatchObject({
			structural: { orphans: 2, widows: 3 },
			order: 4,
		});
		expect(result.nodes["section-experience"]?.style["break-before"]).toBeUndefined();
	});

	it("rejects deep or wide trees one node over the semantic node budget", () => {
		const program = { languageVersion: 1, rules: [] };
		for (const shape of ["deep", "wide"] as const) {
			const result = resolveStylesheet(
				program,
				semanticTreeOfSize(SEMANTIC_CSS_LIMITS_V1.maxSemanticNodes + 1, shape),
				context,
			);
			expect(result.nodes).toEqual({});
			expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_LIMIT", severity: "error" }));
		}
	});
});
