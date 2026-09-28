import type { Extension } from "@codemirror/state";
import type { SemanticCssDiagnostic, SemanticNode } from "@reactive-resume/resume/stylesheet";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { StylesheetSource } from "@reactive-resume/schema/resume/stylesheet";
import type { SemanticCssColorToken } from "./color-tokens";
import type { SemanticCssEditorMetadata } from "./protocol";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightSpecialChars,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { BookOpenIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertLegacyStyleRules } from "@reactive-resume/pdf/semantic-legacy";
import {
	buildSemanticTree,
	getTemplateSemanticManifest,
	semanticNodeKeys,
	shouldShowResumeHeader,
} from "@reactive-resume/pdf/semantic-tree";
import { isFatalStylesheetDiagnostic } from "@reactive-resume/resume/stylesheet";
import { PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Sheet, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { useIsMobile } from "@reactive-resume/ui/hooks/use-mobile";
import { ColorPicker } from "@/components/input/color-picker";
import { useIsResumeLocked, useResumeData, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useTheme } from "@/features/theme/provider";
import { useBuilderSidebarStore } from "@/routes/builder/$resumeId/-store/sidebar";
import { serializeStylesheetColor, toStylesheetPickerColor } from "./color-format";
import { compositionAwareDocumentListener, createSemanticCssEditorExtensions } from "./editor-extensions";
import { enterStylesheetFocusMode } from "./focus-mode";
import { formatEditorDocument } from "./formatter";
import { LegacyStylesheetBanner } from "./legacy-banner";
import { StylesheetStatus } from "./status";
import { StylesheetToolbar } from "./toolbar";
import { createCompileWorkerClient } from "./worker-client";

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

const editorTheme = (dark: boolean): Extension =>
	EditorView.theme(
		{
			"&": {
				height: "100%",
				backgroundColor: "var(--background)",
				color: "var(--foreground)",
				direction: "ltr",
			},
			".cm-scroller": {
				overflow: "auto",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
				lineHeight: "1.5",
			},
			".cm-content": { minHeight: "100%", padding: "0.75rem 0" },
			".cm-gutters": {
				backgroundColor: "var(--muted)",
				borderRight: "1px solid var(--border)",
			},
			".cm-activeLine, .cm-activeLineGutter": {
				backgroundColor: "var(--accent)",
			},
			"&.cm-focused": { outline: "none" },
		},
		{ dark },
	);

const readOnlyExtensions = (readOnly: boolean): Extension => [
	EditorState.readOnly.of(readOnly),
	EditorView.editable.of(!readOnly),
];

export type StylesheetCodeEditorProps = {
	value: string;
	diagnostics: readonly SemanticCssDiagnostic[];
	colorTokens?: readonly SemanticCssColorToken[];
	metadata?: SemanticCssEditorMetadata;
	theme: "light" | "dark";
	readOnly?: boolean;
	label?: string;
	onChange(value: string): void;
	onFocusChange?(focused: boolean): void;
	onReady?(view: EditorView | null): void;
	onUndo(): void;
	onRedo(): void;
};

export function StylesheetCodeEditor({
	value,
	diagnostics,
	colorTokens = [],
	metadata = emptyMetadata,
	theme,
	readOnly = false,
	label = "Semantic CSS stylesheet",
	onChange,
	onFocusChange,
	onReady,
	onUndo,
	onRedo,
}: StylesheetCodeEditorProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const compartmentsRef = useRef<EditorCompartments | null>(null);
	const initialPropsRef = useRef({ value, diagnostics, colorTokens, metadata, theme, readOnly, label });
	const onChangeRef = useRef(onChange);
	const onFocusChangeRef = useRef(onFocusChange);
	const onReadyRef = useRef(onReady);
	const onUndoRef = useRef(onUndo);
	const onRedoRef = useRef(onRedo);
	const [selectedColor, setSelectedColor] = useState<{
		token: SemanticCssColorToken;
		left: number;
		top: number;
	} | null>(null);
	const selectColor = useCallback((token: SemanticCssColorToken, rect: DOMRect) => {
		const hostRect = hostRef.current?.getBoundingClientRect();
		if (!hostRect) return;
		setSelectedColor({ token, left: rect.left - hostRect.left, top: rect.top - hostRect.top });
	}, []);

	onChangeRef.current = onChange;
	onFocusChangeRef.current = onFocusChange;
	onReadyRef.current = onReady;
	onUndoRef.current = onUndo;
	onRedoRef.current = onRedo;

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
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				EditorView.editorAttributes.of({ dir: "ltr" }),
				EditorView.contentAttributes.of({ "aria-label": initial.label, dir: "ltr", spellcheck: "false" }),
				Prec.high(
					keymap.of([
						{
							key: "Mod-z",
							run: () => {
								onUndoRef.current();
								return true;
							},
						},
						{
							key: "Mod-Shift-z",
							run: () => {
								onRedoRef.current();
								return true;
							},
						},
						{
							key: "Mod-y",
							run: () => {
								onRedoRef.current();
								return true;
							},
						},
					]),
				),
				keymap.of([indentWithTab, ...defaultKeymap]),
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
						diagnostics: initial.diagnostics,
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
					diagnostics,
					colorTokens,
					onColorSelect: selectColor,
				}),
			),
		});
	}, [colorTokens, diagnostics, metadata, selectColor]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || view.state.doc.toString() === value) return;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: value },
			annotations: externalReplacement.of(true),
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
			{selectedColor && (
				<div className="pointer-events-none absolute z-20" style={{ left: selectedColor.left, top: selectedColor.top }}>
					<ColorPicker
						open
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
						value={toStylesheetPickerColor(selectedColor.token.value)}
						onChange={updateColor}
						trigger={
							<PopoverTrigger
								render={
									<button
										data-semantic-css-color-picker-trigger=""
										type="button"
										title={t`Edit color ${selectedColor.token.value}`}
										aria-label={t`Edit color ${selectedColor.token.value}`}
										className="pointer-events-auto size-3 rounded-full border border-foreground/40"
										style={{ backgroundColor: selectedColor.token.value }}
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
	};
};

function StylesheetEditorShell({ readOnly = false }: StylesheetEditorShellProps) {
	const { theme } = useTheme();
	const isMobile = useIsMobile();
	const [focusOpen, setFocusOpen] = useState(false);
	const [diagnostics, setDiagnostics] = useState<readonly SemanticCssDiagnostic[]>([]);
	const [colorTokens, setColorTokens] = useState<readonly SemanticCssColorToken[]>([]);
	const [status, setStatus] = useState<"idle" | "compiling" | "error">("compiling");
	const [compiler, setCompiler] = useState<ReturnType<typeof createCompileWorkerClient>>();
	const restoreDesktopRef = useRef<(() => void) | null>(null);
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
		setCompiler(client);
		return () => client.destroy();
	}, []);
	const stylesheet = data?.metadata.stylesheet;
	const mode = stylesheet?.mode ?? "legacy";
	const source = useMemo<StylesheetSource>(
		() =>
			stylesheet?.source ??
			(data ? convertLegacyStyleRules(data).source : { languageVersion: 1, text: "@version 1;\n" }),
		[data, stylesheet],
	);
	const metadata = useMemo(() => (data ? createEditorMetadata(data) : emptyMetadata), [data]);
	const hasFatalErrors = status === "error" || diagnostics.some(isFatalStylesheetDiagnostic);
	const isChecking = status === "compiling";
	const disabled = readOnly || isLocked;

	useEffect(
		() => () => {
			restoreDesktopRef.current?.();
		},
		[],
	);

	useEffect(() => {
		if (!compiler || !data) return;
		let cancelled = false;
		const editGeneration = ++compileGenerationRef.current;
		setStatus("compiling");
		setColorTokens([]);
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
					setDiagnostics(result.diagnostics);
					setColorTokens(result.colorTokens ?? []);
					setStatus(result.program && !result.diagnostics.some(isFatalStylesheetDiagnostic) ? "idle" : "error");
				})
				.catch(() => {
					if (!cancelled && editGeneration === compileGenerationRef.current) setStatus("error");
				});
		}, 180);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [compiler, data, metadata, source]);

	if (!data) return null;

	const setSourceText = (text: string) => {
		if (disabled || text === source.text) return;
		updateResumeData((draft) => {
			draft.metadata.stylesheet = { mode, source: { ...source, text } };
		});
	};

	const activate = () => {
		if (disabled || mode === "semantic" || hasFatalErrors || isChecking) return;
		updateResumeData((draft) => {
			draft.metadata.stylesheet = { mode: "semantic", source };
		});
	};

	const toggleFocus = () => {
		if (isMobile) {
			setFocusOpen((open) => !open);
			return;
		}

		if (restoreDesktopRef.current) {
			restoreDesktopRef.current();
			restoreDesktopRef.current = null;
			setFocusOpen(false);
			return;
		}

		const { rightSidebar, layout, setLayout } = useBuilderSidebarStore.getState();
		restoreDesktopRef.current = enterStylesheetFocusMode({
			rightPanel: rightSidebar,
			currentLayout: layout,
			setLayout,
		});
		setFocusOpen(true);
	};

	const editor = (
		<StylesheetCodeEditor
			value={source.text}
			diagnostics={diagnostics}
			colorTokens={colorTokens}
			metadata={metadata}
			theme={theme}
			readOnly={disabled}
			label={t`Semantic CSS stylesheet`}
			onChange={setSourceText}
			onReady={(view) => {
				editorViewRef.current = view;
			}}
			onUndo={undo}
			onRedo={redo}
		/>
	);
	const editorChrome = (
		<div className="space-y-3">
			{mode === "legacy" && (
				<LegacyStylesheetBanner disabled={disabled || hasFatalErrors || isChecking} onActivate={activate} />
			)}

			<StylesheetToolbar
				source={source.text}
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

			<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<BookOpenIcon aria-hidden="true" className="shrink-0" />
				<span>
					<Trans>Not sure what to write?</Trans>{" "}
					<a
						className="text-primary underline underline-offset-4"
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

			<div className={focusOpen ? (isMobile ? "h-[55svh]" : "h-[calc(100svh-14rem)]") : "h-72"}>{editor}</div>

			<StylesheetStatus mode={mode} status={status} diagnostics={diagnostics} />
		</div>
	);

	return (
		<div>
			{!(isMobile && focusOpen) && editorChrome}
			<Sheet open={isMobile && focusOpen} onOpenChange={setFocusOpen}>
				<SheetContent side="right" className="w-full max-w-full gap-3 overflow-hidden p-4 sm:max-w-full">
					<SheetTitle>
						<Trans>Semantic CSS stylesheet</Trans>
					</SheetTitle>
					<div className="min-h-0 flex-1 overflow-y-auto">{isMobile && focusOpen ? editorChrome : null}</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}

export default StylesheetEditorShell;
