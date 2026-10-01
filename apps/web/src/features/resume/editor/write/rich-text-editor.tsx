import type { ImproveLine } from "./improve";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useKeyboardInset } from "@reactive-resume/ui/hooks/use-keyboard-inset";
import { useIsMobile } from "@reactive-resume/ui/hooks/use-mobile";
import { cn } from "@reactive-resume/utils/style";
import { ImprovePanel, lineAtCaret } from "./improve";
import { hasUnsupportedTableMarkup, richTextExtensions } from "@/components/input/rich-text-extensions";
import { openAssistantFrom } from "@/features/assistant/open";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { usePrompt } from "@/hooks/use-confirm";

type ToolbarAction = {
	icon: IconName;
	label: string;
	isActive?: (editor: Editor) => boolean;
	run: (editor: Editor) => void;
};

/**
 * Bold, Italic, Link, then lists and Clear formatting. Formatting the toolbar doesn't offer (headings,
 * colours, alignment…) still loads and prints; Clear formatting removes it.
 */
function useToolbarActions(): ToolbarAction[] {
	const prompt = usePrompt();

	return [
		{
			icon: "format_bold",
			label: t`Bold`,
			isActive: (editor) => editor.isActive("bold"),
			run: (editor) => editor.chain().focus().toggleBold().run(),
		},
		{
			icon: "format_italic",
			label: t`Italic`,
			isActive: (editor) => editor.isActive("italic"),
			run: (editor) => editor.chain().focus().toggleItalic().run(),
		},
		{
			icon: "link",
			label: t`Link`,
			isActive: (editor) => editor.isActive("link"),
			run: async (editor) => {
				const current = (editor.getAttributes("link").href as string | undefined) ?? "";
				const href = await prompt(t`Link address`, {
					defaultValue: current || "https://",
					description: t`Leave it empty to remove the link.`,
				});
				if (href === null) return editor.commands.focus();
				const chain = editor.chain().focus().extendMarkRange("link");
				if (!href.trim() || href.trim() === "https://") chain.unsetLink().run();
				else chain.setLink({ href: href.trim() }).run();
			},
		},
		{
			icon: "format_list_bulleted",
			label: t`Bulleted list`,
			isActive: (editor) => editor.isActive("bulletList"),
			run: (editor) => editor.chain().focus().toggleBulletList().run(),
		},
		{
			icon: "format_list_numbered",
			label: t`Numbered list`,
			isActive: (editor) => editor.isActive("orderedList"),
			run: (editor) => editor.chain().focus().toggleOrderedList().run(),
		},
		{
			icon: "format_clear",
			label: t`Clear formatting`,
			run: (editor) => editor.chain().focus().clearNodes().unsetAllMarks().unsetTextAlign().run(),
		},
	];
}

type RichTextEditorProps = {
	/** Accessible name of the text box. */
	label: string;
	value: string;
	onChange: (html: string) => void;
	/** Guidance under the text while editing, e.g. "2–3 sentences reads best". */
	hint?: ReactNode;
	disabled?: boolean;
	className?: string;
	/** The text area's id, so other controls can focus it. */
	id?: string;
	/** Replaces the text area's default height (88px to 360px). */
	heightClassName?: string;
};

/**
 * Rich text for descriptions: the toolbar and footer show while the text has focus, the toolbar never
 * takes focus from it, and Markdown shortcuts work ("- " starts a list, "**bold**").
 */
export function RichTextEditor({
	label,
	value,
	onChange,
	hint,
	disabled = false,
	className,
	id,
	heightClassName = "max-h-[360px] min-h-[88px]",
}: RichTextEditorProps) {
	const [focused, setFocused] = useState(false);
	const toolbar = useRef<HTMLDivElement>(null);
	const [improving, setImproving] = useState<ImproveLine | null>(null);
	const actions = useToolbarActions();
	const ai = useHasUsableAiProvider();
	const mobile = useIsMobile();
	const keyboardInset = useKeyboardInset();
	const readOnlyTable = useMemo(() => hasUnsupportedTableMarkup(value), [value]);

	const editor = useEditor({
		extensions: richTextExtensions,
		content: value,
		editable: !disabled && !readOnlyTable,
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		editorProps: {
			attributes: {
				...(id ? { id } : {}),
				"aria-label": label,
				"aria-multiline": "true",
				role: "textbox",
				spellcheck: "true",
				class: cn(
					"wysiwyg overflow-y-auto px-3 py-2 text-sm outline-none",
					heightClassName,
					"[&_[data-resume-whitespace=preserve]]:whitespace-pre-wrap",
				),
			},
		},
		onUpdate: ({ editor }) => onChange(editor.getHTML()),
	});

	const state = useEditorState({
		editor,
		selector: ({ editor }) =>
			editor
				? {
						characters: editor.getText().length,
						active: actions.map((action) => action.isActive?.(editor) ?? false),
						canImprove: lineAtCaret(editor) !== null,
					}
				: { characters: 0, active: [] as boolean[], canImprove: false },
	});

	// Undo, the page and the assistant change the text from outside; keep the editor in step.
	useEffect(() => {
		if (!editor || editor.getHTML() === value) return;
		editor.commands.setContent(value, { emitUpdate: false });
	}, [editor, value]);

	useEffect(() => {
		editor?.setEditable(!disabled && !readOnlyTable, false);
	}, [editor, disabled, readOnlyTable]);

	const editing = focused || improving !== null;

	const startImprove = () => {
		if (!editor) return;
		// Without a provider, the assistant's inline setup connects one.
		if (!ai.hasUsableProvider) return void openAssistantFrom({ assistant: "new" });
		setImproving(lineAtCaret(editor));
	};

	const buttonSize = mobile ? "size-11" : "size-8";
	const toolbarButtons = (
		<>
			{actions.map((action, index) => (
				<button
					key={action.icon}
					type="button"
					aria-label={action.label}
					aria-pressed={action.isActive ? (state?.active[index] ?? false) : undefined}
					title={action.label}
					// Keep the caret in the text while formatting.
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => editor && void action.run(editor)}
					className={cn(
						"flex shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors duration-quick hover:bg-hover",
						buttonSize,
						state?.active[index] && "bg-accent-soft text-accent-text",
						index === 3 && "ms-1.5",
					)}
				>
					<Icon name={action.icon} />
				</button>
			))}
			<button
				type="button"
				aria-expanded={improving !== null}
				disabled={!state?.canImprove && improving === null}
				title={state?.canImprove ? undefined : t`Put the caret in a line to improve it`}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => (improving ? setImproving(null) : startImprove())}
				className={cn(
					"ms-auto flex shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-xs font-semibold text-accent-text transition-[filter] duration-quick hover:brightness-95 disabled:opacity-50",
					mobile ? "h-11" : "h-8",
				)}
			>
				<Icon name="auto_awesome" size={16} />
				<Trans>Improve</Trans>
			</button>
		</>
	);

	return (
		<div
			onFocus={() => setFocused(true)}
			onBlur={(event) => {
				const next = event.relatedTarget;
				if (!event.currentTarget.contains(next) && !toolbar.current?.contains(next)) setFocused(false);
			}}
			className={cn(
				"rounded-lg border border-line-2 bg-raised transition-[border-color,box-shadow] duration-quick",
				editing && "border-accent shadow-[0_0_0_3px_var(--accent-soft)]",
				disabled && "bg-sunken",
				className,
			)}
		>
			{/* On phones the toolbar docks above the keyboard, with Done to put the keyboard away. */}
			{editing &&
				!readOnlyTable &&
				mobile &&
				createPortal(
					<div
						ref={toolbar}
						role="toolbar"
						aria-label={t`Formatting`}
						style={{ bottom: keyboardInset }}
						className="fixed inset-x-0 z-50 flex h-11 items-center gap-0.5 border-t border-line bg-raised px-1.5 shadow-e2"
					>
						<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">{toolbarButtons}</div>
						<button
							type="button"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => {
								setImproving(null);
								setFocused(false);
								editor?.commands.blur();
							}}
							className="flex h-11 shrink-0 items-center rounded-md px-3 text-sm font-semibold text-accent-text"
						>
							<Trans>Done</Trans>
						</button>
					</div>,
					document.body,
				)}

			{readOnlyTable && (
				<p role="status" className="border-b border-line px-3 py-2 text-xs text-ink-2">
					<Trans>
						Original table formatting is preserved. This content is read-only because it cannot be edited safely.
					</Trans>
				</p>
			)}

			<EditorContent editor={editor} />

			{/* Under the text, so focusing the field never moves the line you clicked. */}
			{editing && !readOnlyTable && !mobile && (
				<div
					ref={toolbar}
					role="toolbar"
					aria-label={t`Formatting`}
					className="flex gap-0.5 border-t border-line px-1.5 py-1"
				>
					{toolbarButtons}
				</div>
			)}

			{editor && improving && (
				<ImprovePanel
					key={improving.from}
					editor={editor}
					line={improving}
					where={label}
					onClose={() => setImproving(null)}
				/>
			)}

			{editing && (
				<div className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-xs text-ink-3">
					<span>{hint ?? <Trans>Markdown shortcuts on</Trans>}</span>
					<span className="font-mono">
						<Plural value={state?.characters ?? 0} one="# character" other="# characters" />
					</span>
				</div>
			)}
		</div>
	);
}
