import type { ParsedAtRule, ParsedStylesheet, SemanticCssDiagnostic, SourceRange } from "./types";
import type { CssLocation, CssNode } from "css-tree";
import * as csstree from "css-tree";
import { createDiagnostic, EMPTY_SOURCE_RANGE } from "./diagnostics";

function rangeFromLocation(location: CssLocation | null | undefined): SourceRange {
	if (!location) return EMPTY_SOURCE_RANGE;

	return {
		start: { ...location.start },
		end: { ...location.end },
	};
}

function parseErrorRange(error: unknown): SourceRange {
	if (error && typeof error === "object" && "line" in error && "column" in error && "offset" in error) {
		const { line, column, offset } = error as { line: number; column: number; offset: number };
		return { start: { line, column, offset }, end: { line, column, offset } };
	}

	return EMPTY_SOURCE_RANGE;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unable to parse stylesheet.";
}

function topLevelNodes(stylesheet: CssNode): CssNode[] {
	return stylesheet.children ? [...stylesheet.children] : [];
}

export function parseStylesheet(source: string): ParsedStylesheet {
	const diagnostics: SemanticCssDiagnostic[] = [];
	let ast: CssNode | null = null;

	try {
		ast = csstree.parse(source, {
			positions: true,
			parseCustomProperty: true,
			onParseError(error: unknown) {
				diagnostics.push(createDiagnostic("CSS_PARSE_ERROR", "error", errorMessage(error), parseErrorRange(error)));
			},
			onComment: () => undefined,
			onToken: () => undefined,
		}) as CssNode;
	} catch (error) {
		diagnostics.push(createDiagnostic("CSS_PARSE_ERROR", "error", errorMessage(error), parseErrorRange(error)));
	}

	if (!ast) return { ast: null, atRules: [], rules: [], diagnostics };

	const atRules: ParsedAtRule[] = [];
	const rawRanges = new Set<number>();
	csstree.walk(ast, function (this: { declaration?: { property?: string } | null }, node: CssNode) {
		if (node.type === "Atrule" && node.name) {
			const prelude = node.prelude?.loc
				? source.slice(node.prelude.loc.start.offset, node.prelude.loc.end.offset).trim()
				: "";
			atRules.push({
				name: csstree.ident.decode(node.name).toLowerCase(),
				prelude,
				hasBlock: node.block !== null,
				range: rangeFromLocation(node.loc),
			});
		}
		if (node.type !== "Raw") return;
		if (this.declaration?.property?.startsWith("--")) return;

		const range = rangeFromLocation(node.loc);
		if (rawRanges.has(range.start.offset)) return;

		rawRanges.add(range.start.offset);
		diagnostics.push(createDiagnostic("CSS_RAW_SYNTAX", "error", "Unsupported CSS syntax.", range));
	});

	const nodes = topLevelNodes(ast);

	return {
		ast,
		atRules,
		rules: nodes.filter((node) => node.type === "Rule"),
		diagnostics,
	};
}
