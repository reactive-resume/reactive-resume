import type { SemanticCssColorToken } from "./color-tokens";
import type { SemanticCssEditorMetadata } from "./protocol";
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import type { EditorState, Extension } from "@codemirror/state";
import type { DecorationSet, EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { SemanticNode } from "@reactive-resume/resume/stylesheet/registry";
import { autocompletion } from "@codemirror/autocomplete";
import { search, searchKeymap } from "@codemirror/search";
import { Decoration, EditorView, hoverTooltip, keymap, ViewPlugin, WidgetType } from "@codemirror/view";
import {
	escapeCssIdentifier,
	escapeCssString,
	PROPERTY_REGISTRY_V1,
	SEMANTIC_NODE_KINDS,
	SEMANTIC_REGISTRY_V1,
	SYSTEM_VARIABLE_REGISTRY_V1,
} from "@reactive-resume/resume/stylesheet/registry";

export type SemanticCssColorSelection = (token: SemanticCssColorToken, rect: DOMRect) => void;

const directives = ["@media"] as const;

function walk(root: SemanticNode): SemanticNode[] {
	const nodes: SemanticNode[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		nodes.push(node);
		stack.push(...node.children);
	}
	return nodes;
}

function selectorLabels(metadata: SemanticCssEditorMetadata): string[] {
	const nodes = walk(metadata.semanticTree);
	const attributes = [
		...new Set(["id", "role", ...Object.values(SEMANTIC_REGISTRY_V1).flatMap(({ attributes }) => attributes)]),
	];
	const roles = [...new Set(Object.values(SEMANTIC_REGISTRY_V1).flatMap(({ roles }) => roles))];
	return [
		...new Set([
			...SEMANTIC_NODE_KINDS,
			"*",
			// Readable IDs only (section types): entries' UUIDs escape to `#\30 19b…`; they're offered by name instead.
			...nodes.flatMap((node) => (node.id && escapeCssIdentifier(node.id) === node.id ? [`#${node.id}`] : [])),
			...attributes.map((attribute) => `[${escapeCssIdentifier(attribute)}]`),
			...nodes.flatMap((node) =>
				Object.entries(node.attributes).map(
					([name, value]) => `[${escapeCssIdentifier(name)}=${escapeCssString(value)}]`,
				),
			),
			...roles.map((role) => `[role~=${escapeCssString(role)}]`),
			...metadata.templateParts.map((name) => `template-part[name=${escapeCssString(name)}]`),
			":root",
			":first-child",
			":last-child",
			":only-child",
			":nth-child()",
			":nth-of-type()",
			":is()",
			":where()",
			":not()",
		]),
	];
}

function userVariables(source: string): string[] {
	return [...new Set([...source.matchAll(/(--(?!resume-)[-_a-zA-Z0-9]+)\s*:/g)].map((match) => match[1] as string))];
}

function completionKind(source: string, position: number): "directive" | "property" | "selector" | "system" | "value" {
	const before = source.slice(0, position);
	if (/--resume-[-\w]*$/.test(before)) return "system";
	if (/@[-\w]*$/.test(before)) return "directive";
	const open = before.lastIndexOf("{");
	const close = before.lastIndexOf("}");
	if (open <= close) return "selector";
	const declaration = before.slice(Math.max(open, before.lastIndexOf(";")) + 1);
	return declaration.includes(":") ? "value" : "property";
}

function declarationProperty(source: string, position: number): string | undefined {
	const before = source.slice(0, position);
	const open = before.lastIndexOf("{");
	const close = before.lastIndexOf("}");
	if (open <= close) return;
	const declaration = before.slice(Math.max(open, before.lastIndexOf(";")) + 1);
	const colon = declaration.indexOf(":");
	if (colon < 0) return;
	const property = declaration.slice(0, colon).trim().toLowerCase();
	return property || undefined;
}

function completionLabels(source: string, position: number, metadata: SemanticCssEditorMetadata): string[] {
	switch (completionKind(source, position)) {
		case "directive":
			return [...directives];
		case "property":
			return Object.keys(PROPERTY_REGISTRY_V1);
		case "selector":
			return selectorLabels(metadata);
		case "system":
			return Object.keys(SYSTEM_VARIABLE_REGISTRY_V1);
		case "value": {
			const property = declarationProperty(source, position);
			const definition = property ? PROPERTY_REGISTRY_V1[property] : undefined;
			return [
				...new Set([
					...(definition?.values ?? []),
					...(definition?.units ?? []),
					...userVariables(source),
					...Object.keys(SYSTEM_VARIABLE_REGISTRY_V1),
				]),
			];
		}
	}
}

function getSemanticCssHoverDocumentation(label: string, metadata: SemanticCssEditorMetadata): string | undefined {
	const semantic = SEMANTIC_REGISTRY_V1[label as keyof typeof SEMANTIC_REGISTRY_V1];
	if (semantic) {
		return `Semantic element ${label}. Attributes: ${semantic.attributes.join(", ") || "none"}. Roles: ${semantic.roles.join(", ") || "none"}.`;
	}
	const property = PROPERTY_REGISTRY_V1[label];
	if (property) {
		return `Semantic CSS ${property.category} property ${label}. ${property.inheritable ? "Inherited" : "Not inherited"}. Applies to: ${property.appliesTo.join(", ")}.`;
	}
	const systemVariable = SYSTEM_VARIABLE_REGISTRY_V1[label as keyof typeof SYSTEM_VARIABLE_REGISTRY_V1];
	if (systemVariable) return `Read-only Semantic CSS system variable. ${systemVariable.description}`;
	const normalized = label.startsWith("#") ? label.slice(1) : label;
	const currentNode = walk(metadata.semanticTree).find((node) => node.id === normalized);
	if (currentNode) return `Current resume ${currentNode.kind} ID.`;
	const part = label.match(/^template-part\[name="(.+)"\]$/)?.[1] ?? label;
	if (metadata.templateParts.includes(part)) return `Current template part ${part}.`;
	return;
}

export function compositionAwareDocumentListener(
	onChange: (source: string) => void,
	ignore?: (update: ViewUpdate) => boolean,
): Extension {
	let composing = false;
	return [
		EditorView.domEventHandlers({
			compositionstart: () => {
				composing = true;
				return false;
			},
			compositionend: (_event, view) => {
				composing = false;
				queueMicrotask(() => onChange(view.state.doc.toString()));
				return false;
			},
		}),
		EditorView.updateListener.of((update) => {
			if (update.docChanged && !composing && !ignore?.(update)) onChange(update.state.doc.toString());
		}),
	];
}

function completionSource(metadata: SemanticCssEditorMetadata): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const source = context.state.doc.toString();
		const labels = completionLabels(source, context.pos, metadata);
		const word = context.matchBefore(/(?:--|[-@#])?[-_a-zA-Z0-9]*$/);
		if (!context.explicit && (!word || word.from === word.to)) return null;
		const options: Completion[] = labels.map((label) => ({
			label,
			type: label.startsWith("@") ? "keyword" : label.startsWith("#") || label.includes("[") ? "text" : "property",
		}));
		if (completionKind(source, context.pos) === "selector")
			for (const target of metadata.targets ?? [])
				options.push({ label: target.label, apply: target.selector, detail: target.selector, type: "class", boost: 1 });
		return { from: word?.from ?? context.pos, options, validFor: /[-_@#a-zA-Z0-9]*/ };
	};
}

function tokenAt(state: EditorState, position: number): { from: number; to: number; label: string } | undefined {
	const line = state.doc.lineAt(position);
	const before = line.text.slice(0, position - line.from).match(/(?:--|[#@])?[-_a-zA-Z0-9]+$/)?.[0] ?? "";
	const after = line.text.slice(position - line.from).match(/^[-_a-zA-Z0-9]+/)?.[0] ?? "";
	if (!before && !after) return;
	const from = position - before.length;
	return { from, to: position + after.length, label: `${before}${after}` };
}

function hoverExtension(metadata: SemanticCssEditorMetadata): Extension {
	return hoverTooltip((view, position) => {
		const token = tokenAt(view.state, position);
		if (!token) return null;
		const documentation = getSemanticCssHoverDocumentation(token.label, metadata);
		if (!documentation) return null;
		return {
			pos: token.from,
			end: token.to,
			above: true,
			create() {
				const dom = document.createElement("div");
				dom.className = "cm-semantic-css-hover";
				dom.textContent = documentation;
				return { dom };
			},
		};
	});
}

class ColorSwatch extends WidgetType {
	constructor(
		private readonly token: SemanticCssColorToken,
		private readonly onSelect: SemanticCssColorSelection,
	) {
		super();
	}

	eq(other: ColorSwatch): boolean {
		return (
			other.token.from === this.token.from && other.token.to === this.token.to && other.token.value === this.token.value
		);
	}

	toDOM(): HTMLElement {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "semantic-css-color-swatch";
		button.title = `Edit color ${this.token.value}`;
		button.setAttribute("aria-label", button.title);
		button.style.backgroundColor = this.token.value;
		button.addEventListener("click", () => this.onSelect(this.token, button.getBoundingClientRect()));
		return button;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function colorDecorations(
	view: EditorViewType,
	tokens: readonly SemanticCssColorToken[],
	onSelect: SemanticCssColorSelection,
): DecorationSet {
	const ranges = tokens
		.filter(
			(token) =>
				token.from >= 0 &&
				token.to <= view.state.doc.length &&
				view.visibleRanges.some(({ from, to }) => token.to >= from && token.from <= to),
		)
		.map((token) => Decoration.widget({ widget: new ColorSwatch(token, onSelect), side: 1 }).range(token.to));
	return Decoration.set(ranges, true);
}

function colorExtension(tokens: readonly SemanticCssColorToken[], onSelect: SemanticCssColorSelection): Extension {
	return [
		EditorView.baseTheme({
			".semantic-css-color-swatch": {
				display: "inline-block",
				width: "0.75rem",
				height: "0.75rem",
				marginInline: "0.25rem",
				padding: "0",
				verticalAlign: "middle",
				border: "1px solid currentColor",
				borderRadius: "9999px",
				cursor: "pointer",
			},
		}),
		ViewPlugin.fromClass(
			class {
				decorations: DecorationSet;

				constructor(view: EditorViewType) {
					this.decorations = colorDecorations(view, tokens, onSelect);
				}

				update(update: ViewUpdate) {
					if (update.docChanged || update.viewportChanged) {
						this.decorations = colorDecorations(update.view, tokens, onSelect);
					}
				}
			},
			{ decorations: (plugin) => plugin.decorations },
		),
	];
}

export function createSemanticCssEditorExtensions(input: {
	metadata: SemanticCssEditorMetadata;
	colorTokens: readonly SemanticCssColorToken[];
	onColorSelect: SemanticCssColorSelection;
}): Extension {
	return [
		autocompletion({ override: [completionSource(input.metadata)] }),
		hoverExtension(input.metadata),
		search({ top: true }),
		keymap.of(searchKeymap),
		colorExtension(input.colorTokens, input.onColorSelect),
	];
}

/**
 * Something picked on the page: move the cursor into its rule, adding one (under a comment naming it) when the
 * stylesheet has none yet, and focus the editor.
 */
export function revealStyleRule(view: EditorViewType, target: { selector: string; label: string }): void {
	const text = view.state.doc.toString();
	const existing = text.indexOf(`${target.selector} {`);
	if (existing >= 0) {
		const open = text.indexOf("{", existing) + 1;
		const indent = text.slice(open).match(/^\n\t*/)?.[0].length ?? 0;
		view.dispatch({ selection: { anchor: open + indent }, scrollIntoView: true });
	} else {
		const gap = text.trim().length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
		const block = `${gap}/* ${target.label.replaceAll("*/", "*\\/")} */\n${target.selector} {\n\t\n}\n`;
		const start = text.trim().length === 0 ? 0 : text.length;
		view.dispatch({
			changes: { from: start, to: text.length, insert: block },
			// Inside the empty rule, after its tab.
			selection: { anchor: start + block.length - "\n}\n".length },
			scrollIntoView: true,
		});
	}
	view.focus();
}

export async function copySourceToClipboard(source: string): Promise<void> {
	await navigator.clipboard.writeText(source);
}

export type { SemanticCssEditorMetadata };
