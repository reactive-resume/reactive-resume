import type { SemanticNode } from "./types";
import type { CssNode } from "css-tree";
import SpecificityCalculator from "@bramus/specificity";
import * as csstree from "css-tree";
import { SEMANTIC_CSS_LIMITS_V1 } from "./limits";
import { SEMANTIC_NODE_KINDS, SEMANTIC_REGISTRY_V1 } from "./registry/semantic";

export type Specificity = readonly [ids: number, classes: number, types: number];

type Combinator = " " | ">" | "+" | "~";
type AttributeMatcher = "=" | "~=" | "^=" | "*=";

type CompiledSimpleSelector =
	| { type: "universal" }
	| { type: "type"; name: SemanticNode["kind"] }
	| { type: "id"; value: string }
	| { type: "attribute"; name: string; matcher: AttributeMatcher | null; value: string | null }
	| {
			type: "pseudo";
			name: "is" | "where" | "not";
			selectors: readonly CompiledComplexSelector[];
	  }
	| { type: "pseudo"; name: "root" | "first-child" | "last-child" | "only-child" }
	| {
			type: "pseudo";
			name: "nth-child" | "nth-of-type";
			a: number;
			b: number;
	  };

type CompiledCompoundSelector = {
	selectors: readonly CompiledSimpleSelector[];
};

type CompiledComplexSelector = {
	compounds: readonly CompiledCompoundSelector[];
	combinators: readonly Combinator[];
	specificity: Specificity;
};

export type CompiledSelector = {
	selectors: readonly CompiledComplexSelector[];
};

export type CompileSelectorResult = {
	selector: CompiledSelector | null;
	error?: string;
	resourceLimit?: true;
};

type SelectorAst = {
	type: string;
	name?: string | { name?: string };
	children?: Iterable<SelectorAst> | null;
	matcher?: string | null;
	value?: { name?: string; value?: string } | null;
	flags?: string | null;
	nth?: SelectorAst;
	selector?: SelectorAst | null;
	a?: string | null;
	b?: string | null;
};

type CompileContext = {
	depth: number;
};

class SelectorResourceLimitError extends Error {}

type TreeNode = {
	node: SemanticNode;
	parent: TreeNode | null;
	children: TreeNode[];
};

const knownKinds = new Set<string>(SEMANTIC_NODE_KINDS);
const knownAttributes = new Set([
	"id",
	"role",
	...Object.values(SEMANTIC_REGISTRY_V1).flatMap((definition) => definition.attributes),
]);
const knownRoles = new Set(Object.values(SEMANTIC_REGISTRY_V1).flatMap((definition) => definition.roles));

function childrenOf(node: SelectorAst): SelectorAst[] {
	return node.children ? [...node.children] : [];
}

function identifier(value: string): string {
	return csstree.ident.decode(value);
}

function astName(node: SelectorAst): string {
	if (typeof node.name === "string") return identifier(node.name);
	if (node.name && typeof node.name.name === "string") return identifier(node.name.name);
	throw new Error("Selector name is missing.");
}

function attributeValue(node: SelectorAst): string | null {
	if (!node.value) return null;
	if (typeof node.value.value === "string") return node.value.value;
	if (typeof node.value.name === "string") return identifier(node.value.name);
	throw new Error("Attribute value is missing.");
}

function allowedRoles(type: SemanticNode["kind"] | null): ReadonlySet<string> {
	return type ? new Set(SEMANTIC_REGISTRY_V1[type].roles) : knownRoles;
}

function roleValueIsKnown(matcher: AttributeMatcher | null, value: string | null, roles: ReadonlySet<string>): boolean {
	if (!matcher || value === null) return roles.size > 0;
	if (matcher === "~=") return roles.has(value);
	if (matcher === "=") {
		const tokens = value.split(/\s+/).filter(Boolean);
		return tokens.length > 0 && tokens.every((token) => roles.has(token));
	}

	return [...roles].some((role) => matchesAttribute(role, matcher, value));
}

function validateCompound(selectors: readonly CompiledSimpleSelector[]): void {
	const types = selectors.filter(
		(selector): selector is Extract<CompiledSimpleSelector, { type: "type" }> => selector.type === "type",
	);
	if (types.length > 1) throw new Error("A compound selector can contain only one type selector.");

	const type = types[0]?.name ?? null;
	for (const selector of selectors) {
		if (selector.type !== "attribute") continue;

		if (selector.name === "id") continue;
		if (selector.name === "role") {
			if (!roleValueIsKnown(selector.matcher, selector.value, allowedRoles(type))) {
				throw new Error("Selector uses an unknown role.");
			}
			continue;
		}

		if (type && !(SEMANTIC_REGISTRY_V1[type].attributes as readonly string[]).includes(selector.name)) {
			throw new Error(`Attribute ${selector.name} is not available on ${type}.`);
		}
	}
}

function compileNth(node: SelectorAst, name: "nth-child" | "nth-of-type"): CompiledSimpleSelector {
	const nth = childrenOf(node);
	if (nth.length !== 1 || nth[0]?.type !== "Nth" || !nth[0].nth) {
		throw new Error(`:${name} requires one An+B expression.`);
	}

	const expression = nth[0].nth;
	let a = 0;
	let b = 0;
	if (expression.type === "Identifier") {
		const keyword = astName(expression).toLowerCase();
		if (keyword === "odd") {
			a = 2;
			b = 1;
		} else if (keyword === "even") {
			a = 2;
		} else {
			throw new Error(`Unsupported :${name} expression.`);
		}
	} else if (expression.type === "AnPlusB") {
		a = expression.a === null || expression.a === undefined ? 0 : Number(expression.a);
		b = expression.b === null || expression.b === undefined ? 0 : Number(expression.b);
		if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Invalid :${name} expression.`);
	} else {
		throw new Error(`Unsupported :${name} expression.`);
	}

	if (nth[0].selector) throw new Error(`:${name} does not accept an of selector.`);
	return { type: "pseudo", name, a, b };
}

function compileSimple(node: SelectorAst, context: CompileContext): CompiledSimpleSelector | null {
	switch (node.type) {
		case "TypeSelector": {
			const name = astName(node);
			if (name === "*") return { type: "universal" };
			if (!knownKinds.has(name)) throw new Error(`Unknown semantic element ${name}.`);
			return { type: "type", name: name as SemanticNode["kind"] };
		}
		case "IdSelector":
			return { type: "id", value: astName(node) };
		case "AttributeSelector": {
			const name = astName(node);
			if (!knownAttributes.has(name)) throw new Error(`Unknown semantic attribute ${name}.`);
			if (node.flags) throw new Error("Attribute selector flags are not supported.");
			const matcher = node.matcher as AttributeMatcher | null | undefined;
			if (matcher !== null && matcher !== undefined && !["=", "~=", "^=", "*="].includes(matcher)) {
				throw new Error(`Unsupported attribute matcher ${matcher}.`);
			}
			const value = attributeValue(node);
			if ((matcher === null || matcher === undefined) !== (value === null)) {
				throw new Error("Attribute selector matcher and value must be used together.");
			}
			return { type: "attribute", name, matcher: matcher ?? null, value };
		}
		case "PseudoClassSelector": {
			const name = astName(node);
			if (["root", "first-child", "last-child", "only-child"].includes(name)) {
				if (node.children !== null && node.children !== undefined)
					throw new Error(`:${name} does not accept arguments.`);
				return { type: "pseudo", name: name as "root" | "first-child" | "last-child" | "only-child" };
			}
			if (["is", "where", "not"].includes(name)) {
				if (context.depth >= SEMANTIC_CSS_LIMITS_V1.maxFunctionDepth) {
					throw new SelectorResourceLimitError("Selector function nesting is too deep.");
				}
				const nested = childrenOf(node);
				if (nested.length !== 1 || nested[0]?.type !== "SelectorList") {
					throw new Error(`:${name} requires a selector list.`);
				}
				const selectors = compileSelectorList(nested[0], { depth: context.depth + 1 });
				return { type: "pseudo", name: name as "is" | "where" | "not", selectors };
			}
			if (name === "nth-child" || name === "nth-of-type") return compileNth(node, name);
			throw new Error(`Unsupported pseudo-class :${name}.`);
		}
		case "ClassSelector":
			throw new Error("Custom class selectors are not supported.");
		case "PseudoElementSelector":
			throw new Error("Pseudo-elements are not supported.");
		default:
			throw new Error(`Unsupported selector node ${node.type}.`);
	}
}

function compileComplex(node: SelectorAst, context: CompileContext): CompiledComplexSelector {
	if (node.type !== "Selector") throw new Error("Expected a Selector AST.");

	const compounds: CompiledCompoundSelector[] = [];
	const combinators: Combinator[] = [];
	let selectors: CompiledSimpleSelector[] = [];
	for (const child of childrenOf(node)) {
		if (child.type === "Combinator") {
			const name = astName(child) as Combinator;
			if (![" ", ">", "+", "~"].includes(name) || selectors.length === 0) {
				throw new Error("Unsupported or misplaced combinator.");
			}
			validateCompound(selectors);
			compounds.push({ selectors });
			selectors = [];
			combinators.push(name);
			if (combinators.length > SEMANTIC_CSS_LIMITS_V1.maxCombinatorsPerSelector) {
				throw new SelectorResourceLimitError("Selector has too many combinators.");
			}
			continue;
		}

		const selector = compileSimple(child, context);
		if (selector) selectors.push(selector);
	}

	if (selectors.length === 0 && compounds.length > 0) throw new Error("Selector cannot end with a combinator.");
	validateCompound(selectors);
	compounds.push({ selectors });
	const specificity = SpecificityCalculator.calculateForAST(node).toArray();
	return { compounds, combinators, specificity: [specificity[0], specificity[1], specificity[2]] };
}

function compileSelectorList(node: SelectorAst, context: CompileContext): readonly CompiledComplexSelector[] {
	if (node.type !== "SelectorList") throw new Error("Expected a SelectorList AST.");
	const selectors = childrenOf(node);
	if (selectors.length === 0) {
		throw new Error("Selector list has an unsupported number of selectors.");
	}
	if (selectors.length > SEMANTIC_CSS_LIMITS_V1.maxSelectorsPerRule) {
		throw new SelectorResourceLimitError("Selector list has an unsupported number of selectors.");
	}
	return selectors.map((selector) => compileComplex(selector, context));
}

export function compileSelector(source: string | CssNode): CompileSelectorResult {
	try {
		const text = typeof source === "string" ? source : csstree.generate(source);
		if (Array.from(text).length > SEMANTIC_CSS_LIMITS_V1.maxSelectorCodePoints)
			throw new SelectorResourceLimitError("Selector is too long.");
		const ast = (
			typeof source === "string" ? csstree.parse(source, { context: "selectorList", positions: true }) : source
		) as SelectorAst;
		return { selector: { selectors: compileSelectorList(ast, { depth: 0 }) } };
	} catch (error) {
		return {
			selector: null,
			error: error instanceof Error ? error.message : "Invalid selector.",
			...(error instanceof SelectorResourceLimitError ? { resourceLimit: true } : {}),
		};
	}
}

function buildTree(root: SemanticNode): Map<string, TreeNode> {
	const nodes = new Map<string, TreeNode>();
	const rootNode: TreeNode = { node: root, parent: null, children: [] };
	const stack = [{ source: root, target: rootNode }];
	nodes.set(root.key, rootNode);

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) break;
		current.target.children = current.source.children.map((child) => {
			const target: TreeNode = { node: child, parent: current.target, children: [] };
			nodes.set(child.key, target);
			return target;
		});
		for (let index = current.source.children.length - 1; index >= 0; index--) {
			const source = current.source.children[index];
			const target = current.target.children[index];
			if (source && target) stack.push({ source, target });
		}
	}

	return nodes;
}

function attribute(node: SemanticNode, name: string): string | undefined {
	if (name === "id") return node.id;
	if (name === "role") return node.roles.length > 0 ? node.roles.join(" ") : undefined;
	return Object.hasOwn(node.attributes, name) ? node.attributes[name] : undefined;
}

function matchesAttribute(actual: string, matcher: AttributeMatcher, expected: string): boolean {
	switch (matcher) {
		case "=":
			return actual === expected;
		case "~=":
			return expected !== "" && actual.split(/\s+/).includes(expected);
		case "^=":
			return expected !== "" && actual.startsWith(expected);
		case "*=":
			return expected !== "" && actual.includes(expected);
	}
}

function nthMatches(index: number, a: number, b: number): boolean {
	if (a === 0) return index === b;
	const n = (index - b) / a;
	return Number.isInteger(n) && n >= 0;
}

function siblings(target: TreeNode): readonly TreeNode[] {
	return target.parent?.children ?? [];
}

function matchesSimple(selector: CompiledSimpleSelector, target: TreeNode): boolean {
	switch (selector.type) {
		case "universal":
			return true;
		case "type":
			return target.node.kind === selector.name;
		case "id":
			return target.node.id === selector.value;
		case "attribute": {
			const actual = attribute(target.node, selector.name);
			if (actual === undefined) return false;
			if (!selector.matcher || selector.value === null) return true;
			return matchesAttribute(actual, selector.matcher, selector.value);
		}
		case "pseudo":
			switch (selector.name) {
				case "root":
					return target.parent === null && target.node.kind === "resume";
				case "first-child":
					return siblings(target)[0] === target;
				case "last-child": {
					const values = siblings(target);
					return values[values.length - 1] === target;
				}
				case "only-child":
					return siblings(target).length === 1;
				case "is":
				case "where":
					return selector.selectors.some((nested) => matchesComplex(nested, target));
				case "not":
					return selector.selectors.every((nested) => !matchesComplex(nested, target));
				case "nth-child":
				case "nth-of-type": {
					let values = siblings(target);
					if (selector.name === "nth-of-type") {
						values = values.filter((sibling) => sibling.node.kind === target.node.kind);
					}
					const index = values.indexOf(target);
					return index >= 0 && nthMatches(index + 1, selector.a, selector.b);
				}
			}
	}
}

function matchesCompound(compound: CompiledCompoundSelector, target: TreeNode): boolean {
	return compound.selectors.every((selector) => matchesSimple(selector, target));
}

function matchesComplexAt(selector: CompiledComplexSelector, compoundIndex: number, target: TreeNode): boolean {
	const compound = selector.compounds[compoundIndex];
	if (!compound || !matchesCompound(compound, target)) return false;
	if (compoundIndex === 0) return true;

	switch (selector.combinators[compoundIndex - 1]) {
		case ">":
			return target.parent ? matchesComplexAt(selector, compoundIndex - 1, target.parent) : false;
		case " ": {
			let ancestor = target.parent;
			while (ancestor) {
				if (matchesComplexAt(selector, compoundIndex - 1, ancestor)) return true;
				ancestor = ancestor.parent;
			}
			return false;
		}
		case "+": {
			const values = siblings(target);
			const index = values.indexOf(target);
			return index > 0 ? matchesComplexAt(selector, compoundIndex - 1, values[index - 1] as TreeNode) : false;
		}
		case "~": {
			const values = siblings(target);
			const index = values.indexOf(target);
			return values.slice(0, index).some((sibling) => matchesComplexAt(selector, compoundIndex - 1, sibling));
		}
		default:
			return false;
	}
}

function matchesComplex(selector: CompiledComplexSelector, target: TreeNode): boolean {
	return matchesComplexAt(selector, selector.compounds.length - 1, target);
}

export function createSelectorMatcher(root: SemanticNode): (selector: CompiledSelector, nodeKey: string) => boolean {
	const nodes = buildTree(root);
	return (selector, nodeKey) => {
		const target = nodes.get(nodeKey);
		return target ? selector.selectors.some((complex) => matchesComplex(complex, target)) : false;
	};
}
