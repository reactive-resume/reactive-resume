import type { SemanticCssColorToken } from "./color-tokens";
import type { StyleTarget } from "./targets";
import type {
	AuthoredPageContext,
	BaseSettingsSnapshot,
	SemanticCssDiagnostic,
	SemanticNode,
	StyleProgram,
} from "@reactive-resume/resume/stylesheet";
import type { StylesheetSource } from "@reactive-resume/schema/resume/stylesheet";

export type SemanticCssEditorMetadata = {
	semanticTree: SemanticNode;
	templateParts: readonly string[];
	/** Sections and entries by name, so autocomplete finds "Senior Developer" and inserts its selector. */
	targets?: readonly StyleTarget[];
};

export type CompileWorkerInput = {
	editGeneration: number;
	source: StylesheetSource;
	semanticTree: SemanticNode;
	baseSettings: BaseSettingsSnapshot;
	pages: readonly AuthoredPageContext[];
};

export type CompileWorkerRequest = CompileWorkerInput & {
	type: "compile";
	requestId: number;
};

export type CompileWorkerResponse = {
	type: "compile_result";
	requestId: number;
	editGeneration: number;
	program: StyleProgram | null;
	diagnostics: readonly SemanticCssDiagnostic[];
	colorTokens?: readonly SemanticCssColorToken[];
};
