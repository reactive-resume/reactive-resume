import type { SemanticNode } from "./semantic-types";
import type { Design, Layout, Page, ResumeData, Typography } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";

export type { SemanticNode, SemanticNodeKind } from "./semantic-types";

export type DiagnosticSeverity = "error" | "warning";

export type SourcePosition = {
	line: number;
	column: number;
	offset: number;
};

export type SourceRange = {
	start: SourcePosition;
	end: SourcePosition;
};

export type SemanticCssDiagnostic = {
	code: string;
	severity: DiagnosticSeverity;
	message: string;
	range: SourceRange;
};

export type StyleProgram = {
	languageVersion: number;
	rules: readonly CompiledStyleRule[];
};

export type CompiledDeclaration = {
	property: string;
	value: string;
	important: boolean;
	sourceOrder: number;
	range: SourceRange;
};

export type MediaFeature =
	| {
			name: "width" | "height";
			comparison: "equal" | "min" | "max";
			value: string;
	  }
	| {
			name: "orientation";
			value: "landscape" | "portrait";
	  };

export type CompiledMediaQuery = {
	features: readonly MediaFeature[];
};

export type CompiledStyleRule = {
	selector: import("./selector").CompiledSelector;
	declarations: readonly CompiledDeclaration[];
	media: readonly CompiledMediaQuery[];
	range: SourceRange;
};

export type BaseSettingsSnapshot = Pick<ResumeData, "picture"> & {
	template: Template;
	design: Design;
	typography: Typography;
	page: Page;
	layout: Pick<Layout, "sidebarWidth">;
};

export type AuthoredPageContext = {
	pageKey: string;
	width: number;
	height: number;
};

export type ResolvedNodeStyle = {
	style: Readonly<Record<string, string | number>>;
	specifiedStyleProperties?: readonly string[];
	structural: StructuralPresentation;
	hidden: boolean;
	order: number;
};

export type ResolvedPageSize = "A4" | "LETTER" | { width: number; height?: number };

export type StructuralPresentation = {
	breakBefore?: "page";
	breakInside?: "avoid";
	fixed?: boolean;
	minPresenceAhead?: number;
	orphans?: number;
	widows?: number;
	pageSize?: ResolvedPageSize;
};

export type ResolveStylesheetInput = {
	program: StyleProgram;
	tree: SemanticNode;
	baseStyles: Readonly<Record<string, ResolvedNodeStyle>>;
	baseSettings: BaseSettingsSnapshot;
	pages: readonly AuthoredPageContext[];
	aliases?: Readonly<Record<string, readonly string[]>>;
};

export type ResolveStylesheetContext = Omit<ResolveStylesheetInput, "program" | "tree">;

export type ResolveStylesheetResult = {
	nodes: Readonly<Record<string, ResolvedNodeStyle>>;
	renderTree: SemanticNode;
	diagnostics: readonly SemanticCssDiagnostic[];
};

export type ResolvedPageDimensions = {
	width: number;
	height: number;
};

export type ParsedAtRule = {
	name: string;
	prelude: string;
	hasBlock: boolean;
	range: SourceRange;
};

export type ParsedStylesheet = {
	ast: unknown;
	atRules: readonly ParsedAtRule[];
	rules: readonly unknown[];
	diagnostics: readonly SemanticCssDiagnostic[];
};

export type CompileStylesheetResult = {
	program: StyleProgram | null;
	diagnostics: readonly SemanticCssDiagnostic[];
};
