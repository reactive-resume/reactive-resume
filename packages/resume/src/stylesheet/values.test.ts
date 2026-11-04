import { describe, expect, it } from "vite-plus/test";
import fc from "fast-check";
import { getCachedStylesheet, setCachedStylesheet } from "./cache";
import { compileStylesheet } from "./compile";
import { SEMANTIC_CSS_LIMITS_V1 } from "./limits";

function escapedIdentifier(identifier: string, escaped: readonly boolean[], uppercase: readonly boolean[]): string {
	return [...identifier]
		.map((character, index) => {
			const cased = uppercase[index] ? character.toUpperCase() : character;
			return escaped[index] ? `\\${cased.codePointAt(0)?.toString(16)} ` : cased;
		})
		.join("");
}

function mediaList(count: number): string {
	return Array.from({ length: count }, (_, index) => `(min-width: ${index + 1}pt)`).join(",");
}

function expectedSides(tokens: readonly number[]): readonly [number, number, number, number] {
	switch (tokens.length) {
		case 1:
			return [tokens[0] as number, tokens[0] as number, tokens[0] as number, tokens[0] as number];
		case 2:
			return [tokens[0] as number, tokens[1] as number, tokens[0] as number, tokens[1] as number];
		case 3:
			return [tokens[0] as number, tokens[1] as number, tokens[2] as number, tokens[1] as number];
		default:
			return [tokens[0] as number, tokens[1] as number, tokens[2] as number, tokens[3] as number];
	}
}

describe("Semantic CSS value compilation", () => {
	it("keeps valid rules and declarations when neighboring fragments are invalid", () => {
		const result = compileStylesheet({
			languageVersion: 1,
			text: "@version 1; section:hover { color: red; } name { unknown: 1; opacity: 2; color red; color: #123456; }",
		});

		expect(result.program?.rules).toEqual([
			expect.objectContaining({
				declarations: [expect.objectContaining({ property: "color", value: "#123456" })],
			}),
		]);
		expect(result.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "CSS_PARSE_ERROR", severity: "error" }),
				expect.objectContaining({ code: "INVALID_SELECTOR", severity: "error" }),
				expect.objectContaining({ code: "UNSUPPORTED_PROPERTY", severity: "error" }),
				expect.objectContaining({ code: "INVALID_VALUE", severity: "error" }),
			]),
		);
	});

	it("explains that gradient backgrounds are unsupported and suggests a safe replacement", () => {
		const result = compileStylesheet({
			languageVersion: 1,
			text: "@version 1; header { background-image: linear-gradient(red, blue); color: white; }",
		});

		expect(result.program).not.toBeNull();
		expect(result.program?.rules[0]?.declarations).toContainEqual(
			expect.objectContaining({ property: "color", value: "white" }),
		);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "UNSUPPORTED_PROPERTY",
				severity: "error",
				message: "Gradients are not supported by Semantic CSS. Use background-color or another supported property.",
			}),
		);
	});

	it("rejects non-finite or technically unrenderable absolute lengths", () => {
		for (const value of ["100001pt", "1e309pt"]) {
			const result = compileStylesheet({
				languageVersion: 1,
				text: `@version 1; field { margin-top: ${value}; }`,
			});
			expect(result.program, value).not.toBeNull();
			expect(result.diagnostics, value).toContainEqual(
				expect.objectContaining({ code: "INVALID_VALUE", severity: "error" }),
			);
		}
	});

	it.each([
		{
			name: "source bytes",
			exact: (() => {
				const prefix = "@version 1;";
				return prefix + " ".repeat(SEMANTIC_CSS_LIMITS_V1.maxSourceBytes - new TextEncoder().encode(prefix).byteLength);
			})(),
			oneOver: (() => {
				const prefix = "@version 1;";
				return `${prefix}${" ".repeat(SEMANTIC_CSS_LIMITS_V1.maxSourceBytes - new TextEncoder().encode(prefix).byteLength)} `;
			})(),
			expectedRules: 0,
			expectedDeclarations: undefined,
		},
		{
			name: "rule count",
			exact: `@version 1;${"field{color:red}".repeat(SEMANTIC_CSS_LIMITS_V1.maxRules)}`,
			oneOver: `@version 1;${"field{color:red}".repeat(SEMANTIC_CSS_LIMITS_V1.maxRules + 1)}`,
			expectedRules: SEMANTIC_CSS_LIMITS_V1.maxRules,
			expectedDeclarations: 1,
		},
		{
			name: "declaration count",
			exact: `@version 1;field{${"color:red;".repeat(SEMANTIC_CSS_LIMITS_V1.maxDeclarations)}}`,
			oneOver: `@version 1;field{${"color:red;".repeat(SEMANTIC_CSS_LIMITS_V1.maxDeclarations + 1)}}`,
			expectedRules: 1,
			expectedDeclarations: SEMANTIC_CSS_LIMITS_V1.maxDeclarations,
		},
		{
			name: "function nesting",
			exact: `@version 1;field{color:${"rgb(".repeat(SEMANTIC_CSS_LIMITS_V1.maxFunctionDepth)}0${")".repeat(SEMANTIC_CSS_LIMITS_V1.maxFunctionDepth)}}`,
			oneOver: `@version 1;field{color:${"rgb(".repeat(SEMANTIC_CSS_LIMITS_V1.maxFunctionDepth + 1)}0${")".repeat(SEMANTIC_CSS_LIMITS_V1.maxFunctionDepth + 1)}}`,
			expectedRules: 1,
			expectedDeclarations: 1,
		},
		{
			name: "media nesting",
			exact: `@version 1;${"@media (width: 1pt){".repeat(SEMANTIC_CSS_LIMITS_V1.maxMediaNesting)}field{color:red}${"}".repeat(SEMANTIC_CSS_LIMITS_V1.maxMediaNesting)}`,
			oneOver: `@version 1;${"@media (width: 1pt){".repeat(SEMANTIC_CSS_LIMITS_V1.maxMediaNesting + 1)}field{color:red}${"}".repeat(SEMANTIC_CSS_LIMITS_V1.maxMediaNesting + 1)}`,
			expectedRules: 1,
			expectedDeclarations: 1,
		},
	])(
		"accepts the exact $name limit and rejects one over",
		({ exact, oneOver, expectedRules, expectedDeclarations }) => {
			const accepted = compileStylesheet({ languageVersion: 1, text: exact });
			expect(accepted.program?.rules).toHaveLength(expectedRules);
			if (expectedDeclarations !== undefined) {
				expect(accepted.program?.rules[0]?.declarations).toHaveLength(expectedDeclarations);
			}

			const rejected = compileStylesheet({ languageVersion: 1, text: oneOver });
			expect(rejected.program).toBeNull();
			expect(rejected.diagnostics).toContainEqual(
				expect.objectContaining({ code: "RESOURCE_LIMIT", severity: "error" }),
			);
		},
	);

	it("bounds the Cartesian product of nested media lists before construction", () => {
		const queries = mediaList(33);
		const result = compileStylesheet({
			languageVersion: 1,
			text: `@version 1;@media ${queries}{@media ${queries}{field{color:red}}}`,
		});

		expect(result.program).toBeNull();
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "RESOURCE_LIMIT", severity: "error" }));
	});

	it("expands generated one-to-four-token shorthands with CSS side semantics", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("margin", "padding", "border-width"),
				fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 4 }),
				(property, tokens) => {
					const values = tokens.map((token) => `${token}pt`).join(" ");
					const result = compileStylesheet({
						languageVersion: 1,
						text: `@version 1;section{${property}:${values}}`,
					});
					if (!result.program) throw new Error(result.diagnostics.map(({ code }) => code).join(","));
					const [top, right, bottom, left] = expectedSides(tokens);
					const expected =
						property === "border-width"
							? {
									"border-top-width": `${top}pt`,
									"border-right-width": `${right}pt`,
									"border-bottom-width": `${bottom}pt`,
									"border-left-width": `${left}pt`,
								}
							: {
									[`${property}-top`]: `${top}pt`,
									[`${property}-right`]: `${right}pt`,
									[`${property}-bottom`]: `${bottom}pt`,
									[`${property}-left`]: `${left}pt`,
								};

					expect(
						Object.fromEntries(
							(result.program.rules[0]?.declarations ?? []).map(({ property: name, value }) => [name, value]),
						),
					).toEqual(expected);
				},
			),
			{ numRuns: 60 },
		);
	});

	it("uses a bounded least-recently-used cache by entry count", () => {
		const result = compileStylesheet({ languageVersion: 1, text: "@version 1;" });

		setCachedStylesheet("first", result);
		for (let index = 0; index < 128; index++) setCachedStylesheet(`next-${index}`, result);

		expect(getCachedStylesheet("first")).toBeUndefined();
		expect(getCachedStylesheet("next-0")).toBe(result);
		setCachedStylesheet("last", result);
		expect(getCachedStylesheet("next-1")).toBeUndefined();
	});

	it("never throws for malformed Unicode or case/escape-varied attack values", () => {
		fc.assert(
			fc.property(
				fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((codeUnit) => String.fromCharCode(codeUnit)) }),
				(body) => {
					expect(() => compileStylesheet({ languageVersion: 1, text: `@version 1;${body}` })).not.toThrow();
				},
			),
			{ numRuns: 100 },
		);
		const forbiddenBody = fc.oneof(
			fc
				.tuple(
					fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
					fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
				)
				.map(([escaped, uppercase]) => ({
					body: `@${escapedIdentifier("import", escaped, uppercase)} 'x';`,
					code: "FORBIDDEN_AT_RULE",
				})),
			fc
				.tuple(
					fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
					fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
				)
				.map(([escaped, uppercase]) => ({
					body: `@${escapedIdentifier("font-face", escaped, uppercase)}{}`,
					code: "FORBIDDEN_AT_RULE",
				})),
			fc
				.tuple(
					fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
					fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
				)
				.map(([escaped, uppercase]) => ({
					body: `:root{--x:${escapedIdentifier("url", escaped, uppercase)}(x)}field{color:var(--x)}`,
					code: "FORBIDDEN_CSS_VALUE",
				})),
			fc
				.tuple(
					fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
					fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
				)
				.map(([escaped, uppercase]) => ({
					body: `field{${escapedIdentifier("src", escaped, uppercase)}:x}`,
					code: "FORBIDDEN_CSS_VALUE",
				})),
		);
		fc.assert(
			fc.property(forbiddenBody, ({ body, code }) => {
				const result = compileStylesheet({ languageVersion: 1, text: `@version 1;${body}` });
				expect(result.program).not.toBeNull();
				expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error" }));
			}),
			{ numRuns: 100 },
		);
	});
});
