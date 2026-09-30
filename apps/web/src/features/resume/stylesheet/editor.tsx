import type { SemanticCssColorToken } from "./color-tokens";
import type { SemanticCssEditorMetadata } from "./protocol";
import type { Extension } from "@codemirror/state";
import type { SemanticCssDiagnostic, SemanticNode } from "@reactive-resume/resume/stylesheet";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { StylesheetSource } from "@reactive-resume/schema/resume/stylesheet";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightSpecialChars,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	buildSemanticTree,
	getTemplateSemanticManifest,
	semanticNodeKeys,
	shouldShowResumeHeader,
} from "@reactive-resume/pdf/semantic-tree";
import { isFatalStylesheetDiagnostic } from "@reactive-resume/resume/stylesheet";
import { Icon } from "@reactive-resume/ui/components/icon";
import { PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Sheet, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { useEditorStore } from "../editor/store";
import { serializeStylesheetColor, toStylesheetPickerColor } from "./color-format";
import {
	compositionAwareDocumentListener,
	createSemanticCssEditorExtensions,
	revealStyleRule,
} from "./editor-extensions";
import { formatEditorDocument } from "./formatter";
import { matchedNodeKeys } from "./highlight";
import { listStyleTargets, styleTargetFor } from "./targets";
import { StylesheetToolbar } from "./toolbar";
import { createCompileWorkerClient } from "./worker-client";
import { ColorPicker } from "@/components/input/color-picker";
import { useIsResumeLocked, useResumeData, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useTheme } from "@/features/theme/provider";
import { useClosingValue } from "@/hooks/use-closing-value";

const externalReplacement = Annotation.define<boolean>();
const colorPickerEdit = Annotation.define<boolean>();
const emptyMetadata: SemanticCssEditorMetadata = {
	semanticTree: { key: "resume", kind: "resume", attributes: {}, roles: [], children: [] },
	templateParts: [],
};

type EditorCompartments = {
	theme: Compartment;
	readOnly: Compartment;
	intelligence: Compartment;
};

/** CSS in the app's own inks, so it reads the same in light and dark. */
const highlightStyle = HighlightStyle.define([
	{ tag: [tags.comment, tags.meta], color: "var(--ink-3)", fontStyle: "italic" },
	{ tag: [tags.tagName, tags.className, tags.labelName], color: "var(--accent-text)" },
	{ tag: [tags.propertyName, tags.attributeName], color: "var(--info-text)" },
	{ tag: [tags.string, tags.number, tags.unit, tags.color, tags.atom], color: "var(--warn-text)" },
	{ tag: [tags.keyword, tags.modifier, tags.definitionKeyword, tags.controlKeyword], color: "var(--danger-text)" },
	{ tag: [tags.variableName, tags.function(tags.variableName)], color: "var(--ink)", fontWeight: "500" },
	{ tag: [tags.punctuation, tags.operator, tags.bracket], color: "var(--ink-2)" },
	{ tag: tags.invalid, color: "var(--danger-text)", textDecoration: "underline wavy" },
]);

const editorTheme = (dark: boolean): Extension =>
	EditorView.theme(
		{
			"&": {
				height: "100%",
				backgroundColor: "var(--raised)",
				color: "var(--ink)",
				direction: "ltr",
			},
			".cm-scroller": {
				overflow: "auto",
				fontFamily: "var(--font-mono)",
				lineHeight: "1.5",
			},
			".cm-content": { minHeight: "100%", padding: "0.75rem 0" },
			".cm-gutters": {
				backgroundColor: "var(--sunken)",
				color: "var(--ink-3)",
				borderRight: "1px solid var(--line)",
			},
			".cm-activeLine, .cm-activeLineGutter": {
				backgroundColor: "var(--hover)",
			},
			"&.cm-focused": { outline: "none" },
		},
		{ dark },
	);

const readOnlyExtensions = (readOnly: boolean): Extension => [
	EditorState.readOnly.of(readOnly),
	EditorView.editable.of(!readOnly),
];

type StylesheetCodeEditorProps = {
	value: string;
	colorTokens?: readonly SemanticCssColorToken[];
	metadata?: SemanticCssEditorMetadata;
	theme: "light" | "dark";
	readOnly?: boolean;
	label?: string;
	onChange(value: string): void;
	onFocusChange?(focused: boolean): void;
	/** Where the cursor is while the editor has focus; null once it loses focus. */
	onCursorChange?(offset: number | null): void;
	onReady?(view: EditorView | null): void;
};

function StylesheetCodeEditor({
	value,
	colorTokens = [],
	metadata = emptyMetadata,
	theme,
	readOnly = false,
	label = "Semantic CSS stylesheet",
	onChange,
	onFocusChange,
	onCursorChange,
	onReady,
}: StylesheetCodeEditorProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const compartmentsRef = useRef<EditorCompartments | null>(null);
	const initialPropsRef = useRef({ value, colorTokens, metadata, theme, readOnly, label });
	const onChangeRef = useRef(onChange);
	const onFocusChangeRef = useRef(onFocusChange);
	const onCursorChangeRef = useRef(onCursorChange);
	const onReadyRef = useRef(onReady);
	const [selectedColor, setSelectedColor] = useState<{
		token: SemanticCssColorToken;
		left: number;
		top: number;
	} | null>(null);
	// Closing keeps the picker on its swatch until it has faded out.
	const [shownColor, onColorOpenChangeComplete] = useClosingValue(selectedColor);
	const selectColor = useCallback((token: SemanticCssColorToken, rect: DOMRect) => {
		const hostRect = hostRef.current?.getBoundingClientRect();
		if (!hostRect) return;
		setSelectedColor({ token, left: rect.left - hostRect.left, top: rect.top - hostRect.top });
	}, []);

	useLayoutEffect(() => {
		onChangeRef.current = onChange;
		onFocusChangeRef.current = onFocusChange;
		onCursorChangeRef.current = onCursorChange;
		onReadyRef.current = onReady;
	});

	useEffect(() => {
		const parent = hostRef.current;
		if (!parent) return;
		const initial = initialPropsRef.current;

		const compartments: EditorCompartments = {
			theme: new Compartment(),
			readOnly: new Compartment(),
			intelligence: new Compartment(),
		};
		compartmentsRef.current = compartments;
		const view = new EditorView({
			parent,
			doc: initial.value,
			extensions: [
				lineNumbers(),
				highlightSpecialChars(),
				drawSelection(),
				highlightActiveLine(),
				css(),
				syntaxHighlighting(highlightStyle),
				EditorView.editorAttributes.of({ dir: "ltr" }),
				EditorView.contentAttributes.of({ "aria-label": initial.label, dir: "ltr", spellcheck: "false" }),
				history(),
				keymap.of([...historyKeymap, indentWithTab, ...defaultKeymap]),
				EditorView.domEventHandlers({
					focus: () => {
						onFocusChangeRef.current?.(true);
					},
					blur: () => {
						onFocusChangeRef.current?.(false);
					},
				}),
				compositionAwareDocumentListener(
					(source) => onChangeRef.current(source),
					(update) => update.transactions.some((transaction) => transaction.annotation(externalReplacement)),
				),
				EditorView.updateListener.of((update) => {
					if (update.selectionSet || update.docChanged || update.focusChanged)
						onCursorChangeRef.current?.(update.view.hasFocus ? update.state.selection.main.head : null);
					if (
						update.transactions.some(
							(transaction) => transaction.docChanged && !transaction.annotation(colorPickerEdit),
						)
					) {
						setSelectedColor(null);
					}
				}),
				compartments.theme.of(editorTheme(initial.theme === "dark")),
				compartments.readOnly.of(readOnlyExtensions(initial.readOnly)),
				compartments.intelligence.of(
					createSemanticCssEditorExtensions({
						metadata: initial.metadata,
						colorTokens: initial.colorTokens,
						onColorSelect: selectColor,
					}),
				),
			],
		});
		viewRef.current = view;
		onReadyRef.current?.(view);

		return () => {
			onReadyRef.current?.(null);
			view.destroy();
			viewRef.current = null;
			compartmentsRef.current = null;
		};
	}, [selectColor]);

	useEffect(() => {
		const view = viewRef.current;
		const compartments = compartmentsRef.current;
		if (!view || !compartments) return;
		view.dispatch({ effects: compartments.theme.reconfigure(editorTheme(theme === "dark")) });
	}, [theme]);

	useEffect(() => {
		const view = viewRef.current;
		const compartments = compartmentsRef.current;
		if (!view || !compartments) return;
		view.dispatch({ effects: compartments.readOnly.reconfigure(readOnlyExtensions(readOnly)) });
	}, [readOnly]);

	useEffect(() => {
		const view = viewRef.current;
		const compartments = compartmentsRef.current;
		if (!view || !compartments) return;
		view.dispatch({
			effects: compartments.intelligence.reconfigure(
				createSemanticCssEditorExtensions({
					metadata,
					colorTokens,
					onColorSelect: selectColor,
				}),
			),
		});
	}, [colorTokens, metadata, selectColor]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || view.state.doc.toString() === value) return;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
			annotations: [externalReplacement.of(true), Transaction.addToHistory.of(false)],
		});
	}, [value]);

	const updateColor = (pickerValue: string) => {
		const value = serializeStylesheetColor(pickerValue);
		if (value === null) return;
		const view = viewRef.current;
		if (!view || !selectedColor) return;
		const { from, to } = selectedColor.token;
		if (
			view.state.readOnly ||
			from < 0 ||
			to > view.state.doc.length ||
			from >= to ||
			view.state.doc.sliceString(from, to) !== selectedColor.token.value
		) {
			setSelectedColor(null);
			return;
		}
		view.dispatch({
			changes: { from, to, insert: value },
			annotations: [Transaction.userEvent.of("input"), colorPickerEdit.of(true)],
		});
		setSelectedColor((current) =>
			current
				? {
						...current,
						token: { from, to: from + value.length, value },
					}
				: null,
		);
	};

	return (
		<div ref={hostRef} className="relative h-full overflow-hidden rounded-md border text-xs" dir="ltr">
			{shownColor && (
				<div className="pointer-events-none absolute z-20" style={{ left: shownColor.left, top: shownColor.top }}>
					<ColorPicker
						open={selectedColor !== null}
						onOpenChangeComplete={onColorOpenChangeComplete}
						onOpenChange={(open, details) => {
							const target = details.event.target;
							if (
								target instanceof Element &&
								target.closest(".semantic-css-color-swatch") &&
								hostRef.current?.contains(target)
							)
								return;
							if (!open) setSelectedColor(null);
						}}
						value={toStylesheetPickerColor(shownColor.token.value)}
						onChange={updateColor}
						trigger={
							<PopoverTrigger
								render={
									<button
										data-semantic-css-color-picker-trigger=""
										type="button"
										title={t`Edit color ${shownColor.token.value}`}
										aria-label={t`Edit color ${shownColor.token.value}`}
										className="pointer-events-auto size-3 rounded-full border border-ink/40"
										style={{ backgroundColor: shownColor.token.value }}
									/>
								}
							/>
						}
					/>
				</div>
			)}
		</div>
	);
}

type StylesheetEditorShellProps = {
	readOnly?: boolean;
};

const pageDimensions = (data: ResumeData) => {
	const size = data.metadata.page.format === "letter" ? { width: 612, height: 792 } : { width: 595.28, height: 841.89 };
	return data.metadata.layout.pages.map((_page, index) => ({
		pageKey: semanticNodeKeys.page(index + 1),
		...size,
	}));
};

const createEditorMetadata = (data: ResumeData): SemanticCssEditorMetadata => {
	const pages = data.metadata.layout.pages.map((page, index) =>
		buildSemanticTree({
			data,
			template: data.metadata.template,
			page,
			pageNumber: index + 1,
			showHeader: shouldShowResumeHeader(data, index),
		}),
	);
	const semanticTree: SemanticNode = {
		key: semanticNodeKeys.resume(),
		kind: "resume",
		attributes: { template: data.metadata.template },
		roles: [],
		children: pages.flatMap(({ children }) => children),
	};
	return {
		semanticTree,
		templateParts: getTemplateSemanticManifest(data.metadata.template).parts.map(({ name }) => name),
		targets: listStyleTargets(data, semanticTree),
	};
};

const NO_TOKENS: readonly SemanticCssColorToken[] = [];

function StylesheetEditorShell({ readOnly = false }: StylesheetEditorShellProps) {
	const { resolvedTheme: theme } = useTheme();
	const [focusOpen, setFocusOpen] = useState(false);
	const [compiled, setCompiled] = useState<{
		source: StylesheetSource;
		tokens: readonly SemanticCssColorToken[];
		diagnostics: readonly SemanticCssDiagnostic[];
	}>();
	const [compiler, setCompiler] = useState<ReturnType<typeof createCompileWorkerClient>>();
	const data = useResumeData();
	const updateResumeData = useUpdateResumeData();
	const isLocked = useIsResumeLocked();
	const canUndo = useResumeStore((state) => state.canUndo);
	const canRedo = useResumeStore((state) => state.canRedo);
	const undo = useResumeStore((state) => state.undo);
	const redo = useResumeStore((state) => state.redo);
	const editorViewRef = useRef<EditorView | null>(null);
	const compileGenerationRef = useRef(0);
	useEffect(() => {
		const client = createCompileWorkerClient(
			() =>
				new Worker(new URL("./stylesheet.worker.ts", import.meta.url), {
					type: "module",
					name: "semantic-css-compiler",
				}),
		);
		// oxlint-disable-next-line react/set-state-in-effect -- the worker is created here so it can be destroyed on unmount
		setCompiler(client);
		return () => client.destroy();
	}, []);
	const stylesheet = data?.metadata.stylesheet;
	const source = useMemo<StylesheetSource>(
		// Resumes reach the builder with legacy rules already converted (the API does it), so there is one stylesheet.
		() => stylesheet?.source ?? { languageVersion: 1, text: "" },
		[stylesheet],
	);
	const metadata = useMemo(() => (data ? createEditorMetadata(data) : emptyMetadata), [data]);
	const disabled = readOnly || isLocked;
	// Swatches belong to the source they were compiled from; they go once it changes.
	const colorTokens = compiled?.source === source ? compiled.tokens : NO_TOKENS;

	// Picking something on the page (Design) aims the stylesheet at it: its rule, added if there isn't one.
	useEffect(() => {
		if (disabled || !data) return;
		return useEditorStore.subscribe((state, previous) => {
			const view = editorViewRef.current;
			if (!view || !state.selection || state.selection === previous.selection) return;
			revealStyleRule(view, styleTargetFor(data, state.selection));
		});
	}, [data, disabled]);

	// The rule under the cursor is outlined on the page, and nothing is once the editor loses focus or closes.
	useEffect(() => () => useEditorStore.getState().setStyleHighlight([]), []);
	const highlightRuleAt = (offset: number | null) => {
		const view = editorViewRef.current;
		const keys =
			offset === null || !view ? [] : matchedNodeKeys(view.state.doc.toString(), offset, metadata.semanticTree);
		const { styleHighlight, setStyleHighlight } = useEditorStore.getState();
		if (keys.length !== styleHighlight.length || keys.some((key, index) => key !== styleHighlight[index]))
			setStyleHighlight(keys);
	};

	useEffect(() => {
		if (!compiler || !data) return;
		let cancelled = false;
		const editGeneration = ++compileGenerationRef.current;
		const timer = window.setTimeout(() => {
			void compiler
				.compile({
					editGeneration,
					source,
					semanticTree: metadata.semanticTree,
					baseSettings: {
						picture: data.picture,
						template: data.metadata.template,
						design: data.metadata.design,
						typography: data.metadata.typography,
						page: data.metadata.page,
						layout: { sidebarWidth: data.metadata.layout.sidebarWidth },
					},
					pages: pageDimensions(data),
				})
				.then((result) => {
					if (cancelled || result.editGeneration !== compileGenerationRef.current) return;
					setCompiled({
						source,
						tokens: result.colorTokens ?? [],
						diagnostics: result.diagnostics.filter(isFatalStylesheetDiagnostic),
					});
				})
				// Swatches are a nicety: a stylesheet that doesn't compile just shows none.
				.catch(() => undefined);
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [compiler, data, metadata, source]);

	if (!data) return null;

	// Stylesheets saved before the version moved out of the text start with `@version 1;`: it isn't shown, and the
	// first edit drops it (the compiler ignores it either way).
	const text = source.text.replace(/^\s*@version\s+\d+\s*;[ \t]*\r?\n?/, "");

	const setSourceText = (next: string) => {
		if (disabled || next === text) return;
		updateResumeData((draft) => {
			draft.metadata.stylesheet = { mode: "semantic", source: { ...source, text: next } };
		});
	};

	// Focus mode opens the editor in a large dialog; the editor panel has a fixed width.
	const toggleFocus = () => setFocusOpen((open) => !open);

	const editor = (
		<StylesheetCodeEditor
			value={text}
			colorTokens={colorTokens}
			metadata={metadata}
			theme={theme}
			readOnly={disabled}
			label={t`Semantic CSS stylesheet`}
			onChange={setSourceText}
			onCursorChange={highlightRuleAt}
			onReady={(view) => {
				editorViewRef.current = view;
			}}
		/>
	);
	const editorChrome = (
		<div className="space-y-3">
			<StylesheetToolbar
				source={text}
				canUndo={canUndo}
				canRedo={canRedo}
				focused={focusOpen}
				disabled={disabled}
				onUndo={undo}
				onRedo={redo}
				onFormat={() => {
					const view = editorViewRef.current;
					if (view) void formatEditorDocument(view).catch(() => undefined);
				}}
				onFocusToggle={toggleFocus}
			/>
			{compiled?.source === source && compiled.diagnostics.length > 0 && (
				<div role="alert" className="text-xs text-danger-text">
					<p>
						<Trans>Custom styles aren't applied. Fix these errors to apply them:</Trans>
					</p>
					<ul className="list-inside list-disc">
						{compiled.diagnostics.map((diagnostic, index) => (
							<li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
						))}
					</ul>
				</div>
			)}
			<p className="text-xs text-ink-3">
				<Trans>
					PDF styles support a subset of CSS. Rotation, dashed and dotted borders, and some layout properties are
					ignored.
				</Trans>
			</p>

			<p className="flex items-center gap-1.5 text-xs text-ink-3">
				<Icon name="ink_highlighter" size={16} aria-hidden="true" className="shrink-0" />
				<span>
					<Trans>Click anything on the page to style it. The rule you're in is outlined on the page.</Trans>
				</span>
			</p>

			<p className="flex items-center gap-1.5 text-xs text-ink-3">
				<Icon name="menu_book" size={16} aria-hidden="true" className="shrink-0" />
				<span>
					<Trans>Not sure what to write?</Trans>{" "}
					<a
						className="text-accent-text underline underline-offset-4"
						href="https://docs.rxresu.me/applying-custom-styles"
						target="_blank"
						rel="noopener noreferrer"
					>
						<Trans>Read the Applying Custom Styles guide.</Trans>
						<span className="sr-only">
							{" "}
							(<Trans>opens in new tab</Trans>)
						</span>
					</a>
				</span>
			</p>

			<div className={focusOpen ? "h-[55svh] sm:h-[calc(100svh-14rem)]" : "h-72"}>{editor}</div>
		</div>
	);

	return (
		<div>
			{!focusOpen && editorChrome}
			<Sheet open={focusOpen} onOpenChange={setFocusOpen}>
				<SheetContent side="right" className="w-full max-w-full gap-3 overflow-hidden p-4 sm:max-w-full">
					<SheetTitle>
						<Trans>Semantic CSS stylesheet</Trans>
					</SheetTitle>
					<div className="min-h-0 flex-1 overflow-y-auto">{focusOpen ? editorChrome : null}</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

export default StylesheetEditorShell;
