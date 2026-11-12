import type { DocumentSummary } from "./filter";
import type { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useInView } from "motion/react";
import { useId, useRef, useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@reactive-resume/ui/components/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { DocumentMenuContent, useDocumentActions } from "./document-actions";
import { DocumentStatusBadge, useDocumentSentAt } from "./document-status";
import { documentKey, formatEdited } from "./filter";
import { InlineNameInput } from "./inline-name-input";
import { letterBodyLines, letterGreeting } from "./letter-preview";
import { useNewDocumentsStore } from "./new-documents";
import { ResumeThumbnail } from "./resume-thumbnail";
import { DataTableCell, DataTableRow } from "@/components/calm/data-table";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { revealOnRowClassName, rowLinkClassName } from "@/components/calm/list-row";
import { StageDot } from "@/components/calm/stage-dot";
import { getStageLabel } from "@/features/applications/stages";
import { ENTER_CLASS, stagger } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

export type DocumentItemProps = {
	document: DocumentSummary;
	onTags: (document: DocumentSummary) => void;
	onLink: (document: DocumentSummary) => void;
	/** Position in the library's first appearance, which staggers in; undefined afterwards. */
	introIndex?: number | undefined;
	/** Whether the document is in the selection. */
	selected?: boolean | undefined;
	onSelectedChange?: ((selected: boolean) => void) | undefined;
	/** Something is selected, so clicking a card toggles it instead of opening it. */
	selecting?: boolean | undefined;
	disabled?: boolean | undefined;
};

/** "Resume · edited 16 minutes ago". */
function useDocumentMeta(document: DocumentSummary) {
	const { i18n } = useLingui();
	const edited = formatEdited(document.editedAt, i18n.locale);
	return document.type === "resume" ? t`Resume · edited ${edited}` : t`Cover letter · edited ${edited}`;
}

/** Opens the document in its editor: resumes and letters share the editor shell. */
function OpenLink({
	document,
	className,
	children,
	label,
	describedBy,
	onSelect,
	disabled,
	dir,
	paper = false,
}: Pick<DocumentItemProps, "document" | "disabled"> & {
	/** The link is the card's page: named `paper` for the layout comparison, which skips what the page draws. */
	paper?: boolean;
	className?: string;
	/** The id of an extra description, such as a letter's opening lines, so equal names stay distinguishable. */
	describedBy?: string | undefined;
	/** "auto" when the link's text is the document's name, so the name keeps its own direction. */
	dir?: "auto";
	children: React.ReactNode;
	label?: string;
	/** While selecting, a click toggles the document instead of opening it. */
	onSelect?: (() => void) | undefined;
}) {
	const markOpened = useNewDocumentsStore((state) => state.markOpened);
	if (disabled)
		return (
			<span aria-disabled={disabled} className={className} dir={dir} data-design={paper ? "paper" : undefined}>
				{children}
			</span>
		);
	const onClick = (event: React.MouseEvent) => {
		if (!onSelect) return markOpened(document.id);
		event.preventDefault();
		onSelect();
	};
	const common = {
		"aria-label": label,
		"aria-describedby": describedBy,
		"data-design": paper ? "paper" : undefined,
		className,
		onClick,
		dir,
	};

	return document.type === "resume" ? (
		<Link to="/builder/$resumeId" params={{ resumeId: document.id }} {...common}>
			{children}
		</Link>
	) : (
		<Link to="/builder/letter/$coverLetterId" params={{ coverLetterId: document.id }} {...common}>
			{children}
		</Link>
	);
}

/** Enter commits, Esc cancels, and leaving the field commits. */
function RenameInput({ document, onDone }: { document: DocumentSummary; onDone: () => void }) {
	const actions = useDocumentActions();
	return <InlineNameInput name={document.name} onSave={(value) => actions.rename(document, value)} onDone={onDone} />;
}

/**
 * A letter's page: its recipient and opening lines, so several letters can be told apart. The text is the owner's own
 * letter, read only once the card nears the viewport and cached until the letter's content changes (`editedAt`).
 */
function LetterThumbnail({ document, descriptionId }: { document: DocumentSummary; descriptionId: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const isInView = useInView(containerRef, { amount: 0.1, margin: "240px" });
	const options = orpc.coverLetters.getById.queryOptions({ input: { id: document.id } });
	const letter = useQuery({
		...options,
		// A content edit moves `editedAt`, so the preview fetches the new letter instead of showing a stale one.
		queryKey: [...options.queryKey, new Date(document.editedAt).getTime()],
		enabled: document.type === "letter" && isInView,
		staleTime: "static",
	});
	const recipient = document.recipient;
	const greeting = letter.data ? letterGreeting(letter.data.greeting) : null;
	const lines = letter.data ? letterBodyLines(letter.data.content) : [];
	const empty = letter.isSuccess && !greeting && lines.length === 0;
	const preview = [greeting, lines[0]].filter(Boolean).join(" ");
	const status = letter.isError ? t`Preview unavailable` : empty ? t`Empty letter` : "";
	const description = [recipient ? `${recipient}.` : "", preview, status].filter(Boolean).join(" ");

	return (
		<>
			<div ref={containerRef} aria-hidden="true" className="flex size-full flex-col gap-1 bg-white p-[14%] text-[0]">
				<span className="h-1.5 w-2/5 rounded-sm bg-[#c9c9c9]" />
				{recipient ? (
					<span className="truncate text-[10px] leading-4 font-semibold text-[#3a3a3a]">{recipient}</span>
				) : null}
				{greeting ? <span className="truncate text-[9px] leading-3 text-[#3a3a3a]">{greeting}</span> : null}
				{lines.length > 0 ? (
					lines.map((line, index) => (
						<span key={`${index}-${line}`} className="line-clamp-2 text-[9px] leading-3 text-[#6d6d6d]">
							{line}
						</span>
					))
				) : letter.isError ? (
					<span className="truncate text-[9px] leading-3 text-[#9a9a9a]">
						<Trans>Preview unavailable</Trans>
					</span>
				) : empty ? (
					<span className="truncate text-[9px] leading-3 text-[#9a9a9a]">
						<Trans>Empty letter</Trans>
					</span>
				) : letter.isSuccess ? null : (
					// Loading: keep the page's shape rather than an empty frame.
					Array.from({ length: 7 }, (_, index) => (
						<span key={index} className={cn("h-1 rounded-sm bg-[#e6e6e6]", index % 3 === 2 ? "w-4/5" : "w-full")} />
					))
				)}
			</div>
			{/* Outside the aria-hidden page: the link's accessible name stays the document name, and this reads the
			    letter's own opening words so two equally named letters remain distinguishable. */}
			<span id={descriptionId} className="sr-only">
				{description}
			</span>
		</>
	);
}

const isTouch = (event: Event | undefined) =>
	!!event && (event.type.startsWith("touch") || ("pointerType" in event && event.pointerType === "touch"));

/**
 * On touch, a long press selects the document instead of opening its context menu, as in the mobile app; the ⋯ menu
 * keeps every action. Base UI times the press (500ms, cancelled by a 10px move); the tap that ends it is swallowed so
 * it doesn't open the document or toggle it straight back.
 */
function useLongPressSelect(onSelectedChange: ((selected: boolean) => void) | undefined) {
	const swallowClick = useRef(false);
	const onOpenChange = (open: boolean, details: ContextMenuPrimitive.Root.ChangeEventDetails) => {
		if (!open || !onSelectedChange || !isTouch(details.event)) return;
		details.cancel();
		swallowClick.current = true;
		setTimeout(() => (swallowClick.current = false), 800);
		navigator.vibrate?.(10);
		onSelectedChange(true);
	};
	const onClickCapture = (event: React.MouseEvent) => {
		if (!swallowClick.current) return;
		swallowClick.current = false;
		event.preventDefault();
		event.stopPropagation();
	};
	return { onOpenChange, onClickCapture };
}

/** Appears on hover and focus; stays while its menu is open. Touch has no hover, so it always shows there. */
const revealOnCardClassName =
	"opacity-0 transition-opacity duration-quick group-focus-within/card:opacity-100 group-hover/card:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100";

/** What sits beside the status badge: New, a lock that isn't a sent one, and the job or recipient the document is for. */
function DocumentNotes({ document, isNew, showFor }: { document: DocumentSummary; isNew: boolean; showFor: boolean }) {
	const sentAt = useDocumentSentAt(document);
	// One inline box, so the icon and its words truncate together.
	const quiet = "min-w-0 truncate text-[13px]/5 text-ink-3";
	const icon = "me-[5px] inline-block align-[-2px]";
	return (
		<>
			{isNew && (
				<Badge variant="solid">
					<Trans>New</Trans>
				</Badge>
			)}
			{/* A sent document's badge already carries the lock. */}
			{document.isLocked && sentAt === null && (
				<span className={quiet}>
					<Icon name="lock-simple" size={14} className={icon} />
					<Trans>Locked</Trans>
				</span>
			)}
			{showFor &&
				(document.application ? (
					<span className={quiet} dir="auto">
						<Icon name="briefcase" size={14} className={icon} />
						<Trans comment="The job a document is for, under its name in the library">
							For {document.application.company}
						</Trans>
					</span>
				) : (
					document.recipient && (
						<span className={quiet}>
							<Icon name="envelope-simple" size={14} className={icon} />
							<Trans comment="A letter's recipient under its name in the library">To {document.recipient}</Trans>
						</span>
					)
				))}
		</>
	);
}

/** A card: the real first page, the name in full, "Resume · edited 16 minutes ago", then the status and the job. */
export function DocumentCard({
	document,
	onTags,
	onLink,
	introIndex,
	selected = false,
	onSelectedChange,
	selecting = false,
	disabled = false,
}: DocumentItemProps) {
	const openDocument = useOpenDocument();
	const descriptionId = useId();
	const requestedRename = useNewDocumentsStore((state) => state.renameId === document.id);
	const [localRenaming, setLocalRenaming] = useState(false);
	const renaming = localRenaming || requestedRename;
	const setRenaming = (value: boolean) => {
		setLocalRenaming(value);
		if (!value && requestedRename) useNewDocumentsStore.getState().requestRename(null);
	};
	const isNew = useNewDocumentsStore((state) => state.ids.includes(document.id));
	const meta = useDocumentMeta(document);
	const menuProps = {
		document,
		onOpen: () => openDocument(document),
		onRename: () => setRenaming(true),
		onTags: () => onTags(document),
		onLink: () => onLink(document),
		onSelect: onSelectedChange && !selected ? () => onSelectedChange(true) : undefined,
	};
	const longPress = useLongPressSelect(onSelectedChange);

	return (
		<ContextMenu onOpenChange={longPress.onOpenChange}>
			<ContextMenuTrigger
				onClickCapture={longPress.onClickCapture}
				render={
					<article
						data-document-key={documentKey(document)}
						style={introIndex === undefined ? undefined : stagger(introIndex)}
						className={cn(
							// Paper, name, detail, status: the rows are the grid's, so every card in a row lines up.
							"group/card row-span-4 grid min-w-0 grid-rows-subgrid gap-0 pb-8",
							introIndex !== undefined && ENTER_CLASS,
							isNew && "animate-arrive",
						)}
					/>
				}
			>
				<div className="relative">
					<OpenLink
						document={document}
						disabled={disabled}
						paper
						label={document.name}
						describedBy={document.type === "letter" ? descriptionId : undefined}
						onSelect={selecting && onSelectedChange ? () => onSelectedChange(!selected) : undefined}
						className={cn(
							"relative block aspect-page overflow-hidden rounded-paper bg-paper shadow-[var(--shadow-1),0_0_0_1px_var(--line)] transition-shadow duration-quick ease-enter [-webkit-touch-callout:none] group-focus-within/card:shadow-[var(--shadow-2),0_0_0_1px_var(--line-2)] group-hover/card:shadow-[var(--shadow-2),0_0_0_1px_var(--line-2)]",
							selected && "shadow-[0_0_0_2px_var(--accent),var(--shadow-1)]!",
						)}
					>
						{document.type === "resume" ? (
							<ResumeThumbnail resume={document} />
						) : (
							<LetterThumbnail document={document} descriptionId={descriptionId} />
						)}
					</OpenLink>
					{/* On the paper, which is white in both themes: these two controls keep paper inks. */}
					<span className="absolute end-2.5 top-2.5 flex items-center gap-2">
						{onSelectedChange && (
							<Checkbox
								disabled={disabled}
								checked={selected}
								onCheckedChange={onSelectedChange}
								aria-label={t`Select ${document.name}`}
								className={cn(
									"not-data-checked:border-[#888680] not-data-checked:bg-paper",
									// Touch has no hover: there the box appears once a long press starts selecting.
									!selecting && cn(revealOnCardClassName, "pointer-coarse:hidden"),
								)}
							/>
						)}
						<span className={cn("flex", !selecting && revealOnCardClassName)}>
							<DropdownMenu>
								<DropdownMenuTrigger
									disabled={disabled}
									render={
										<IconButton
											icon="dots-three"
											size="icon-sm"
											label={t`Options for ${document.name}`}
											className="bg-paper text-[#44423d] shadow-[inset_0_0_0_1px_#c9c6be] hover:bg-paper hover:text-[#1f1e1b]"
										/>
									}
								/>
								{!disabled && <DocumentMenuContent {...menuProps} />}
							</DropdownMenu>
						</span>
					</span>
				</div>

				{renaming && !disabled ? (
					<div className="mt-3">
						<RenameInput document={document} onDone={() => setRenaming(false)} />
					</div>
				) : (
					// Right under the page's h1: an h2, so heading levels don't skip. Two lines, so a long name reads in full.
					<h2 dir="auto" className="mt-3 line-clamp-2 [overflow-wrap:anywhere] t-row-title">
						{document.name}
					</h2>
				)}
				<span className="mt-0.5 truncate text-ink-3 t-small">{meta}</span>
				<span className="mt-2 flex min-h-5 min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
					<DocumentStatusBadge document={document} />
					<DocumentNotes document={document} isNew={isNew} showFor />
				</span>
			</ContextMenuTrigger>
			{!disabled && <DocumentMenuContent {...menuProps} variant="context" />}
		</ContextMenu>
	);
}

/** The list view's row: Name with its status, Type, Application with its stage, Edited, ⋯. */
export function DocumentRow({
	document,
	onTags,
	onLink,
	introIndex,
	selected = false,
	onSelectedChange,
	selecting = false,
	disabled = false,
}: DocumentItemProps) {
	const { i18n } = useLingui();
	const openDocument = useOpenDocument();
	const requestedRename = useNewDocumentsStore((state) => state.renameId === document.id);
	const [localRenaming, setLocalRenaming] = useState(false);
	const renaming = localRenaming || requestedRename;
	const setRenaming = (value: boolean) => {
		setLocalRenaming(value);
		if (!value && requestedRename) useNewDocumentsStore.getState().requestRename(null);
	};
	const isNew = useNewDocumentsStore((state) => state.ids.includes(document.id));
	const menuProps = {
		document,
		onOpen: () => openDocument(document),
		onRename: () => setRenaming(true),
		onTags: () => onTags(document),
		onLink: () => onLink(document),
	};
	const longPress = useLongPressSelect(onSelectedChange);
	// A column value starts its cell: "Yesterday", "Tuesday".
	const edited = formatEdited(document.editedAt, i18n.locale);

	return (
		<ContextMenu onOpenChange={longPress.onOpenChange}>
			<ContextMenuTrigger
				onClickCapture={longPress.onClickCapture}
				render={
					<DataTableRow
						selected={selected}
						data-document-key={documentKey(document)}
						aria-disabled={disabled}
						style={introIndex === undefined ? undefined : stagger(introIndex)}
						className={cn(introIndex !== undefined && ENTER_CLASS)}
					/>
				}
			>
				{onSelectedChange && (
					<DataTableCell className="justify-center">
						<Checkbox
							disabled={disabled}
							checked={selected}
							onCheckedChange={onSelectedChange}
							aria-label={t`Select ${document.name}`}
							className={cn(
								"z-10",
								// The box shows on hover or focus and stays while anything is selected. Touch: a long press selects.
								!selecting && cn(revealOnRowClassName, "pointer-coarse:hidden"),
							)}
						/>
					</DataTableCell>
				)}
				<DataTableCell header className="gap-3.5">
					<DocumentThumb kind={document.type} />
					{/* Beside the name from 640; under it on phones, where the name needs the whole line. */}
					<span className="flex min-w-0 flex-1 items-center gap-3.5 max-sm:flex-col max-sm:items-start max-sm:gap-0.5">
						{renaming && !disabled ? (
							<span className="relative z-10 min-w-0 flex-1">
								<RenameInput document={document} onDone={() => setRenaming(false)} />
							</span>
						) : (
							<OpenLink
								document={document}
								disabled={disabled}
								dir="auto"
								onSelect={selecting && onSelectedChange ? () => onSelectedChange(!selected) : undefined}
								className={cn("max-w-full min-w-0 truncate t-row-title", rowLinkClassName)}
							>
								{document.name}
							</OpenLink>
						)}
						<span className="flex shrink-0 items-center gap-2.5">
							<DocumentStatusBadge document={document} />
							<DocumentNotes document={document} isNew={isNew} showFor={false} />
						</span>
					</span>
				</DataTableCell>
				<DataTableCell className="text-sm max-sm:hidden">
					<span>{document.type === "resume" ? <Trans>Resume</Trans> : <Trans>Cover letter</Trans>}</span>
				</DataTableCell>
				<DataTableCell className="max-sm:hidden">
					{document.application ? (
						<>
							<StageDot status={document.application.status} className="min-w-0 gap-2 text-sm">
								<span dir="auto" className="truncate">
									{document.application.company}
								</span>
							</StageDot>
							<span className="shrink-0 text-ink-3 t-small">· {getStageLabel(document.application.status)}</span>
						</>
					) : (
						<span className="text-ink-3 t-small">
							<Trans>Not linked</Trans>
						</span>
					)}
				</DataTableCell>
				<DataTableCell>
					<span className="whitespace-nowrap text-ink-3 t-small">
						{edited.charAt(0).toLocaleUpperCase(i18n.locale) + edited.slice(1)}
					</span>
				</DataTableCell>
				<DataTableCell>
					<DropdownMenu>
						<DropdownMenuTrigger
							disabled={disabled}
							render={
								<IconButton
									icon="dots-three"
									size="icon-sm"
									label={t`Options for ${document.name}`}
									className="relative z-10 text-ink-2"
								/>
							}
						/>
						{!disabled && <DocumentMenuContent {...menuProps} />}
					</DropdownMenu>
				</DataTableCell>
			</ContextMenuTrigger>
			{!disabled && <DocumentMenuContent {...menuProps} variant="context" />}
		</ContextMenu>
	);
}

/** Open from a menu: resumes in the editor, letters in the letter editor. */
function useOpenDocument() {
	const navigate = useNavigate();
	return (document: DocumentSummary) => {
		useNewDocumentsStore.getState().markOpened(document.id);
		if (document.type === "letter") {
			void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: document.id } });
			return;
		}
		void navigate({ to: "/builder/$resumeId", params: { resumeId: document.id } });
	};
}
