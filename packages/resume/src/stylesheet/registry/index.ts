/// <reference path="../css-tree.d.ts" />
/// <reference path="../specificity.d.ts" />

export type { SemanticCssCompilerDiagnosticCode } from "../diagnostics";
export type { SemanticCssDiagnostic, SemanticNode } from "../types";
export type { PropertyDefinition, PropertyRegistry } from "./properties";
export type { SemanticNodeDefinition, SemanticRegistry } from "./semantic";
export type { SystemVariableDefinition, SystemVariableRegistry } from "./system-variables";
export { escapeCssIdentifier, escapeCssString } from "../css-escape";
export { SEMANTIC_CSS_DIAGNOSTIC_CATALOG_V1 } from "../diagnostics";
export {
	PROPERTY_REGISTRY_V1,
	SEMANTIC_CSS_BORDER_STYLE_VALUES_V1,
	SEMANTIC_CSS_CSS_WIDE_KEYWORDS_V1,
	SEMANTIC_CSS_LENGTH_PROPERTIES_V1,
	SEMANTIC_CSS_LENGTH_UNITS_V1,
	SEMANTIC_CSS_LENGTH_VALUE_KEYWORDS_V1,
} from "./properties";
export { SEMANTIC_NODE_KINDS, SEMANTIC_REGISTRY_V1, TEMPLATE_PART_CHILD_KINDS_V1 } from "./semantic";
export { SYSTEM_VARIABLE_REGISTRY_V1 } from "./system-variables";
