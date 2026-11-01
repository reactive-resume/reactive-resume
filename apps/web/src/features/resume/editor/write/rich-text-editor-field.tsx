import type { ImproveLine } from "./improve";
import type { Menu } from "@base-ui/react/menu";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { useKeyboardInset } from "@reactive-resume/ui/hooks/use-keyboard-inset";
import { cn } from "@reactive-resume/utils/style";
import { ImprovePanel, lineAtCaret } from "./improve";
import { acceptImproveLine } from "./improve-history";
import { richTextExtensions } from "@/components/input/rich-text-extensions";
import { hasUnsupportedTableMarkup, toPreviewHtml } from "@/components/input/rich-text-markup";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { usePrompt } from "@/hooks/use-confirm";

type ToolbarAction = {
	icon: IconName;
	label: string;
	isActive?: (editor: Editor) => boolean;
	run: (editor: Editor) => void;
};

/**
 * Bold, Italic, Underline, Link, then lists; alignment and the rarer formatting (strikethrough, code, highlight,
 * headings, colour, indent, a rule and Clear formatting) sit in two menus so the toolbar fits a narrow column.
 */
function useToolbarActions(): ToolbarAction[] {
	const prompt = usePrompt();

	return [
		{
			icon: "text-b",
			label: t`Bold`,
			isActive: (editor) => editor.isActive("bold"),
			run: (editor) => editor.chain().focus().toggleBold().run(),
		},
		{
			icon: "text-italic",
			label: t`Italic`,
			isActive: (editor) => editor.isActive("italic"),
			run: (editor) => editor.chain().focus().toggleItalic().run(),
		},
		{
			icon: "text-underline",
			label: t`Underline`,
			isActive: (editor) => editor.isActive("underline"),
			run: (editor) => editor.chain().focus().toggleUnderline().run(),
		},
		{
			icon: "link-simple-horizontal",
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
			icon: "list-bullets",
			label: t`Bulleted list`,
			isActive: (editor) => editor.isActive("bulletList"),
			run: (editor) => editor.chain().focus().toggleBulletList().run(),
		},
		{
			icon: "list-numbers",
			label: t`Numbered list`,
			isActive: (editor) => editor.isActive("orderedList"),
			run: (editor) => editor.chain().focus().toggleOrderedList().run(),
		},
	];
}

// The first list button starts a new group in the toolbar.
const LIST_GROUP_START = 4;

const ALIGNMENTS = ["left", "center", "right", "justify"] as const;
type Alignment = (typeof ALIGNMENTS)[number];
const ALIGNMENT_ICONS: Record<Alignment, IconName> = {
	left: "text-align-left",
	center: "text-align-center",
	right: "text-align-right",
	justify: "text-align-justify",
};

// Dark enough to read on white paper; "" is the template's own text colour.
const TEXT_COLORS = ["", "#dc2626", "#ea580c", "#16a34a", "#2563eb", "#7c3aed", "#6b7280"] as const;

type FormattingState = {
	align: Alignment;
	strike: boolean;
	code: boolean;
	highlight: boolean;
	/** 0 for a paragraph, else the heading level. */
	block: number;
	color: string;
};

const readFormatting = (editor: Editor): FormattingState => ({
	align: ALIGNMENTS.find((align) => align !== "left" && editor.isActive({ textAlign: align })) ?? "left",
	strike: editor.isActive("strike"),
	code: editor.isActive("code"),
	highlight: editor.isActive("highlight"),
	block: [1, 2, 3].find((level) => editor.isActive("heading", { level })) ?? 0,
	color: (editor.getAttributes("textStyle").color as string | undefined) ?? "",
});

const DEFAULT_FORMATTING: FormattingState = {
	align: "left",
	strike: false,
	code: false,
	highlight: false,
	block: 0,
	color: "",
};

/**
 * Keeps the toolbar up while one of its menus is open and returns the caret to the text when it closes; a click
 * outside the open menu leaves the field, like a click outside the toolbar.
 */
function useToolbarMenus(editor: Editor | null, onLeave: () => void) {
	const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
	const leaving = useRef(false);

	const rootProps = (menu: string) => ({
		modal: false,
		onOpenChange: (next: boolean, details: Menu.Root.ChangeEventDetails) => {
			setOpenMenus((current) => ({ ...current, [menu]: next }));
			leaving.current = !next && (details.reason === "outside-press" || details.reason === "focus-out");
			if (leaving.current) onLeave();
		},
	});
	const contentProps = {
		"data-toolbar-menu": "",
		finalFocus: () => (leaving.current ? false : (editor?.view.dom ?? true)),
	};
	return { open: Object.values(openMenus).some(Boolean), rootProps, contentProps };
}

/** Where a click on the read-only preview landed, or "end" when focus arrived another way. */
export type FocusRequest = { x: number; y: number } | "end" | undefined;

export type RichTextEditorProps = {
	/** Accessible name of the text box. */
	label: string;
	value: string;
	onChange: (html: string, options?: { newStep?: boolean }) => void;
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
 * Loaded on demand by ./rich-text-editor.tsx, which keeps Tiptap out of the builder's first render.
 *
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
	focusRequest,
}: RichTextEditorProps & { focusRequest?: FocusRequest }) {
	const [focused, setFocused] = useState(false);
	const toolbar = useRef<HTMLDivElement>(null);
	const [improving, setImproving] = useState<ImproveLine | null>(null);
	const actions = useToolbarActions();
	const ai = useHasUsableAiProvider();
	const mobile = useBreakpoint() === "mobile";
	const keyboardInset = useKeyboardInset();
	const acceptedReplacement = useRef(false);
	const readOnlyTable = useMemo(() => hasUnsupportedTableMarkup(value), [value]);
	const editorValue = useMemo(() => (readOnlyTable ? toPreviewHtml(value) : value), [readOnlyTable, value]);

	const editor = useEditor({
		extensions: richTextExtensions,
		content: editorValue,
		editable: !disabled && !readOnlyTable,
		immediatelyRender: false,
		shouldRerenderOnTransaction: false,
		editorProps: {
			transformPastedHTML: (html) => (hasUnsupportedTableMarkup(html) ? toPreviewHtml(html) : html),
			attributes: {
				...(id ? { id } : {}),
				"aria-label": label,
				"aria-multiline": "true",
				role: "textbox",
				spellcheck: "true",
				class: cn(
					"typeset typeset-field overflow-y-auto px-3 py-2 text-sm outline-none",
					heightClassName,
					"[&_[data-resume-whitespace=preserve]]:whitespace-pre-wrap",
				),
			},
		},
		onUpdate: ({ editor }) => {
			const newStep = acceptedReplacement.current;
			acceptedReplacement.current = false;
			onChange(editor.getHTML(), newStep ? { newStep: true } : undefined);
		},
	});

	const state = useEditorState({
		editor,
		selector: ({ editor }) =>
			editor
				? {
						characters: editor.getText().length,
						active: actions.map((action) => action.isActive?.(editor) ?? false),
						canImprove: lineAtCaret(editor) !== null,
						formatting: readFormatting(editor),
					}
				: { characters: 0, active: [] as boolean[], canImprove: false, formatting: DEFAULT_FORMATTING },
	});
	const menus = useToolbarMenus(editor, () => setFocused(false));

	// Undo, the page and the assistant change the text from outside; keep the editor in step.
	useEffect(() => {
		if (!editor || editor.getHTML() === editorValue) return;
		editor.commands.setContent(editorValue, { emitUpdate: false });
	}, [editor, editorValue]);

	useEffect(() => {
		editor?.setEditable(!disabled && !readOnlyTable, false);
	}, [editor, disabled, readOnlyTable]);

	// The preview took a click or focus while the editor loaded: put the caret there, after the editor's first paint.
	useEffect(() => {
		if (!editor || !focusRequest) return;
		const frame = requestAnimationFrame(() => {
			const at = focusRequest === "end" ? null : editor.view.posAtCoords({ left: focusRequest.x, top: focusRequest.y });
			editor.commands.focus(at?.pos ?? "end");
		});
		return () => cancelAnimationFrame(frame);
	}, [editor, focusRequest]);

	const editing = focused || improving !== null || menus.open;

	const acceptImprove = (line: ImproveLine, text: string) => {
		if (!editor) return;
		acceptedReplacement.current = true;
		acceptImproveLine(editor, line, text);
	};

	const startImprove = () => {
		if (!editor || ai.isUnavailable) return;
		// Without a provider, the assistant's inline setup connects one.
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
						toolbarButtonClassName,
						buttonSize,
						state?.active[index] && "bg-accent-soft text-accent-text",
						index === LIST_GROUP_START && "ms-1.5",
					)}
				>
					<Icon name={action.icon} />
				</button>
			))}
			{editor && (
				<FormattingMenus
					editor={editor}
					formatting={state?.formatting ?? DEFAULT_FORMATTING}
					buttonClassName={cn(toolbarButtonClassName, buttonSize)}
					side={mobile ? "top" : "bottom"}
					menus={menus}
				/>
			)}
			<button
				type="button"
				aria-expanded={improving !== null}
				disabled={ai.isUnavailable || (!state?.canImprove && improving === null)}
				title={state?.canImprove ? undefined : t`Put the caret in a line to improve it`}
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => (improving ? setImproving(null) : startImprove())}
				className={cn(
					"ms-auto flex shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2.5 text-xs font-semibold text-accent-text transition-[filter] duration-quick hover:brightness-95 disabled:opacity-50",
					mobile ? "h-11" : "h-8",
				)}
			>
				<Icon name="sparkle" size={16} />
				{/* Icon only where the toolbar is narrow, so the formatting buttons keep one row. */}
				<span className="@max-[24rem]:sr-only">
					<Trans>Improve</Trans>
				</span>
			</button>
		</>
	);

	return (
		<div
			onFocus={() => setFocused(true)}
			onBlur={(event) => {
				const next = event.relatedTarget;
				// Opening a toolbar menu moves focus into it; the menu reports leaving the field itself.
				const inMenu = next instanceof Element && next.closest("[data-toolbar-menu]") !== null;
				if (!event.currentTarget.contains(next) && !toolbar.current?.contains(next) && !inMenu) setFocused(false);
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
			{editing && <AiProviderLoadState state={ai} />}

			{/* Under the text, so focusing the field never moves the line you clicked. */}
			{editing && !readOnlyTable && !mobile && (
				<div
					ref={toolbar}
					role="toolbar"
					aria-label={t`Formatting`}
					className="@container flex flex-wrap gap-0.5 border-t border-line px-1.5 py-1"
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
					onAccept={(text) => acceptImprove(improving, text)}
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

const toolbarButtonClassName =
	"flex shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors duration-quick hover:bg-hover data-popup-open:bg-hover";

type FormattingMenusProps = {
	editor: Editor;
	formatting: FormattingState;
	buttonClassName: string;
	side: "top" | "bottom";
	menus: ReturnType<typeof useToolbarMenus>;
};

/** Alignment, then everything else the toolbar has no room for. */
function FormattingMenus({ editor, formatting, buttonClassName, side, menus }: FormattingMenusProps) {
	const chain = () => editor.chain().focus();
	const alignLabels: Record<Alignment, string> = {
		left: t`Align left`,
		center: t`Align center`,
		right: t`Align right`,
		justify: t`Justify`,
	};
	const colorLabels: Record<(typeof TEXT_COLORS)[number], string> = {
		"": t`Default`,
		"#dc2626": t`Red`,
		"#ea580c": t`Orange`,
		"#16a34a": t`Green`,
		"#2563eb": t`Blue`,
		"#7c3aed": t`Purple`,
		"#6b7280": t`Gray`,
	};
	const blocks = [
		{ level: 0, icon: "paragraph", label: t`Paragraph` },
		{ level: 1, icon: "text-h-one", label: t`Heading 1` },
		{ level: 2, icon: "text-h-two", label: t`Heading 2` },
		{ level: 3, icon: "text-h-three", label: t`Heading 3` },
	] as const;
	const setBlock = (level: number) =>
		level === 0
			? chain().setParagraph().run()
			: chain()
					.setHeading({ level: level as 1 | 2 | 3 })
					.run();

	return (
		<>
			<DropdownMenu {...menus.rootProps("align")}>
				<DropdownMenuTrigger
					aria-label={t`Text alignment`}
					title={t`Text alignment`}
					className={cn(buttonClassName, "ms-1.5", formatting.align !== "left" && "bg-accent-soft text-accent-text")}
				>
					<Icon name={ALIGNMENT_ICONS[formatting.align]} />
				</DropdownMenuTrigger>
				<DropdownMenuContent side={side} className="w-44" {...menus.contentProps}>
					<DropdownMenuRadioGroup
						value={formatting.align}
						onValueChange={(align: Alignment) =>
							align === "left" ? chain().unsetTextAlign().run() : chain().setTextAlign(align).run()
						}
					>
						{ALIGNMENTS.map((align) => (
							<DropdownMenuRadioItem key={align} value={align}>
								<Icon name={ALIGNMENT_ICONS[align]} />
								{alignLabels[align]}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>

			<DropdownMenu {...menus.rootProps("more")}>
				<DropdownMenuTrigger aria-label={t`More formatting`} title={t`More formatting`} className={buttonClassName}>
					<Icon name="dots-three" />
				</DropdownMenuTrigger>
				<DropdownMenuContent side={side} className="w-56" {...menus.contentProps}>
					<DropdownMenuCheckboxItem checked={formatting.strike} onCheckedChange={() => chain().toggleStrike().run()}>
						<Icon name="text-strikethrough" />
						<Trans>Strikethrough</Trans>
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem checked={formatting.code} onCheckedChange={() => chain().toggleCode().run()}>
						<Icon name="code" />
						<Trans>Code</Trans>
					</DropdownMenuCheckboxItem>
					<DropdownMenuCheckboxItem
						checked={formatting.highlight}
						onCheckedChange={() => chain().toggleHighlight().run()}
					>
						<Icon name="highlighter" />
						<Trans>Highlight</Trans>
					</DropdownMenuCheckboxItem>

					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="palette" />
							<Trans>Text color</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent {...menus.contentProps}>
							<DropdownMenuRadioGroup
								value={formatting.color}
								onValueChange={(color: string) => (color ? chain().setColor(color).run() : chain().unsetColor().run())}
							>
								{TEXT_COLORS.map((color) => (
									<DropdownMenuRadioItem key={color || "default"} value={color}>
										<span
											aria-hidden="true"
											className="size-3.5 rounded-sm border border-line-2"
											style={{ background: color || "var(--ink)" }}
										/>
										{colorLabels[color]}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Icon name="text-aa" />
							<Trans>Text style</Trans>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent {...menus.contentProps}>
							<DropdownMenuRadioGroup value={formatting.block} onValueChange={(level: number) => setBlock(level)}>
								{blocks.map((block) => (
									<DropdownMenuRadioItem key={block.level} value={block.level}>
										<Icon name={block.icon} />
										{block.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => chain().increaseIndent().run()}>
						<Icon name="text-indent" />
						<Trans>Indent</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => chain().decreaseIndent().run()}>
						<Icon name="text-outdent" />
						<Trans>Outdent</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => chain().setHorizontalRule().run()}>
						<Icon name="minus" />
						<Trans>Horizontal line</Trans>
					</DropdownMenuItem>

					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => chain().clearNodes().unsetAllMarks().unsetTextAlign().run()}>
						<Icon name="text-t-slash" />
						<Trans>Clear formatting</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
