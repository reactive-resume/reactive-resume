import type { DocumentSummary } from "./filter";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useInView } from "motion/react";
import { useId, useRef, useState } from "react";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@reactive-resume/ui/components/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { DocumentMenuContent, useDocumentActions } from "./document-actions";
import { daysLeftInTrash, documentKey } from "./filter";
import { InlineNameInput } from "./inline-name-input";
import { letterBodyLines, letterGreeting } from "./letter-preview";
import { useNewDocumentsStore } from "./new-documents";
import { ResumeThumbnail } from "./resume-thumbnail";
import { formatRelativeTime } from "@/libs/locale";
import { ENTER_CLASS, stagger } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

export type DocumentItemProps = {
	document: DocumentSummary;
	onTags: (document: DocumentSummary) => void;
	onLink: (document: DocumentSummary) => void;
	/** Position in the library's first appearance, which staggers in; undefined afterwards and in Trash. */
	introIndex?: number | undefined;
	/** Whether the document is in the selection; Trash has no selection. */
	selected?: boolean | undefined;
	onSelectedChange?: ((selected: boolean) => void) | undefined;
	/** Something is selected, so clicking a card toggles it instead of opening it. */
	selecting?: boolean | undefined;
	disabled?: boolean | undefined;
};

/** "Resume · Edited 2h ago", or the days left for a document in Trash. */
function useDocumentMeta(document: DocumentSummary) {
	const { i18n } = useLingui();
	const type = document.type === "resume" ? t`Resume` : t`Letter`;
	if (document.trashedAt)
		return plural(daysLeftInTrash(document.trashedAt), { one: `${type} · # day left`, other: `${type} · # days left` });
	// Short, so the card's narrow meta line shows the whole time instead of "Edited 20 minutes a…".
	return t`${type} · Edited ${formatRelativeTime(document.editedAt, i18n.locale, "short")}`;
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
}: Pick<DocumentItemProps, "document" | "disabled"> & {
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
	if (document.trashedAt || disabled)
		return (
			<span aria-disabled={disabled} className={className} dir={dir}>
				{children}
			</span>
		);
	const onClick = (event: React.MouseEvent) => {
		if (!onSelect) return markOpened(document.id);
		event.preventDefault();
		onSelect();
	};
	const common = { "aria-label": label, "aria-describedby": describedBy, className, onClick, dir };

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
	const description =
		[recipient, greeting, lines[0]].filter(Boolean).join(". ") ||
		(letter.isError ? t`Preview unavailable` : empty ? t`Empty letter` : "");

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

/** A status chip on the page thumbnail. The page is white in both themes, so the chip doesn't follow the theme. */
type PaperBadgeProps = { icon: "globe" | "lock" | "password"; label: string };

function PaperBadge({ icon, label }: PaperBadgeProps) {
	return (
		<span className="grid size-[22px] place-items-center rounded-sm bg-ink text-bg" title={label}>
			<Icon name={icon} size={14} />
			<span className="sr-only">{label}</span>
		</span>
	);
}

/** A 204px card: the real first page, title with ⋯, "Resume · Edited 2h ago" and the linked application. */
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
	const isNew = useNewDocumentsStore((state) => state.ids.includes(document.id)) && !document.trashedAt;
	const meta = useDocumentMeta(document);
	const recipient = document.recipient;
	const menuProps = {
		document,
		onOpen: () => openDocument(document),
		onRename: () => setRenaming(true),
		onTags: () => onTags(document),
		onLink: () => onLink(document),
		onSelect: onSelectedChange && !selected ? () => onSelectedChange(true) : undefined,
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={
					<article
						data-document-key={documentKey(document)}
						style={introIndex === undefined ? undefined : stagger(introIndex)}
						className={cn(
							// content-start: a neighbour's extra application line doesn't push this card's title down.
							"group/card grid content-start gap-2",
							introIndex !== undefined && ENTER_CLASS,
							isNew && "animate-arrive",
							document.trashedAt && "opacity-70",
						)}
					/>
				}
			>
				<div className="relative">
					<OpenLink
						document={document}
						disabled={disabled}
						label={document.name}
						describedBy={document.type === "letter" ? descriptionId : undefined}
						onSelect={selecting && onSelectedChange ? () => onSelectedChange(!selected) : undefined}
						className={cn(
							"relative block aspect-page overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line),var(--shadow-1)] transition-[translate,scale,box-shadow] duration-quick ease-enter hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_var(--line),var(--shadow-2)] active:scale-[0.98]",
							// Only a selection gets the accent ring; a new card says so with its New badge.
							selected &&
								"shadow-[0_0_0_2px_var(--accent),var(--shadow-1)] hover:shadow-[0_0_0_2px_var(--accent),var(--shadow-2)] starting:shadow-[0_0_0_2px_transparent,var(--shadow-1)]",
							document.trashedAt && "pointer-events-none",
						)}
					>
						{document.type === "resume" ? (
							<ResumeThumbnail resume={document} />
						) : (
							<LetterThumbnail document={document} descriptionId={descriptionId} />
						)}
						{/* Bottom of the paper: its top is where every template prints the person's name. */}
						<span className="absolute start-2 bottom-2 flex gap-1">
							{isNew && (
								<span className="rounded bg-accent px-1.5 text-xs leading-[18px] font-semibold text-on-accent">
									<Trans>New</Trans>
								</span>
							)}
							{/* A protected link reads differently from an open one, as in the builder's details. */}
							{document.isPublic &&
								(document.hasPassword ? (
									<PaperBadge icon="password" label={t`Public, with a password`} />
								) : (
									<PaperBadge icon="globe" label={t`Public`} />
								))}
							{document.isLocked && <PaperBadge icon="lock" label={t`Locked`} />}
						</span>
					</OpenLink>
					{onSelectedChange && (
						<Checkbox
							disabled={disabled}
							checked={selected}
							onCheckedChange={onSelectedChange}
							aria-label={t`Select ${document.name}`}
							className={cn(
								"absolute end-2 top-2 shadow-e1 transition-[opacity,background-color,border-color] duration-quick",
								// Touch has no hover: the box stays visible there, as the list view's does.
								!selecting &&
									"opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
							)}
						/>
					)}
				</div>

				<div className="flex items-start gap-1">
					<div className="grid min-w-0 flex-1 gap-0.5">
						{renaming && !disabled ? (
							<RenameInput document={document} onDone={() => setRenaming(false)} />
						) : (
							// Right under the page's h1: an h2, so heading levels don't skip.
							<h2 dir="auto" className="truncate text-sm leading-5 font-semibold">
								{document.name}
							</h2>
						)}
						<span className="truncate text-xs text-ink-3">{meta}</span>
						{document.application ? (
							<span className="flex min-w-0 items-center gap-1 text-xs text-ink-2">
								<Icon name="briefcase" size={14} />
								<span dir="auto" className="truncate">
									{document.application.company}
								</span>
							</span>
						) : (
							recipient && (
								<span className="flex min-w-0 items-center gap-1 text-xs text-ink-2">
									<Icon name="envelope-simple" size={14} />
									<span className="truncate">
										<Trans comment="A letter's recipient under its name in the library">To {recipient}</Trans>
									</span>
								</span>
							)
						)}
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger
							disabled={disabled}
							render={
								<IconButton
									icon="dots-three"
									size="icon-sm"
									label={t`Options for ${document.name}`}
									className="text-ink-2"
								/>
							}
						/>
						{!disabled && <DocumentMenuContent {...menuProps} />}
					</DropdownMenu>
				</div>
			</ContextMenuTrigger>
			{!disabled && <DocumentMenuContent {...menuProps} variant="context" />}
		</ContextMenu>
	);
}

/** The list view's row: Name, Type, Application, Edited, ⋯. */
export function DocumentRow({
	document,
	onTags,
	onLink,
	introIndex,
	selected = false,
	onSelectedChange,
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
	const isNew = useNewDocumentsStore((state) => state.ids.includes(document.id)) && !document.trashedAt;
	const menuProps = {
		document,
		onOpen: () => openDocument(document),
		onRename: () => setRenaming(true),
		onTags: () => onTags(document),
		onLink: () => onLink(document),
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={
					<tr
						data-document-key={documentKey(document)}
						aria-disabled={disabled}
						style={introIndex === undefined ? undefined : stagger(introIndex)}
						className={cn(
							"border-b border-line transition-colors duration-quick hover:bg-hover",
							selected && "bg-accent-soft hover:bg-accent-soft",
							introIndex !== undefined && ENTER_CLASS,
							document.trashedAt && "opacity-70",
						)}
					/>
				}
			>
				{onSelectedChange && (
					<td className="w-10 ps-3">
						<Checkbox
							disabled={disabled}
							checked={selected}
							onCheckedChange={onSelectedChange}
							aria-label={t`Select ${document.name}`}
						/>
					</td>
				)}
				<td className="py-3 ps-3 pe-2">
					<span className="flex min-w-0 items-center gap-2.5">
						<Icon name={document.type === "resume" ? "file-text" : "envelope-simple"} className="shrink-0 text-ink-2" />
						{renaming && !disabled ? (
							<RenameInput document={document} onDone={() => setRenaming(false)} />
						) : (
							<OpenLink
								document={document}
								disabled={disabled}
								dir="auto"
								className="min-w-0 truncate text-start text-sm font-semibold hover:underline"
							>
								{document.name}
							</OpenLink>
						)}
						{isNew && (
							<span className="rounded bg-accent px-1.5 text-xs leading-[18px] font-semibold text-on-accent">
								<Trans>New</Trans>
							</span>
						)}
						{document.isPublic && (
							<span
								title={document.hasPassword ? t`Public, with a password` : t`Public`}
								className="shrink-0 text-ink-3"
							>
								<Icon name={document.hasPassword ? "password" : "globe"} size={16} />
								<span className="sr-only">
									{document.hasPassword ? <Trans>Public, with a password</Trans> : <Trans>Public</Trans>}
								</span>
							</span>
						)}
						{document.isLocked && (
							<span title={t`Locked`} className="flex shrink-0 items-center">
								<Icon name="lock" size={16} className="text-ink-3" />
								<span className="sr-only">
									<Trans>Locked</Trans>
								</span>
							</span>
						)}
					</span>
				</td>
				<td className="px-2 text-sm text-ink-2 max-sm:hidden">
					{document.type === "resume" ? <Trans>Resume</Trans> : <Trans>Letter</Trans>}
				</td>
				<td dir="auto" className="truncate px-2 text-sm text-ink-2 max-sm:hidden">
					{document.application?.company ?? "—"}
				</td>
				<td className="px-2 text-sm whitespace-nowrap text-ink-3">
					{document.trashedAt ? (
						<Plural value={daysLeftInTrash(document.trashedAt)} one="# day left" other="# days left" />
					) : (
						formatRelativeTime(document.editedAt, i18n.locale)
					)}
				</td>
				<td className="w-10 pe-2 text-end">
					<DropdownMenu>
						<DropdownMenuTrigger
							disabled={disabled}
							render={
								<IconButton
									icon="dots-three"
									size="icon-sm"
									label={t`Options for ${document.name}`}
									className="text-ink-2"
								/>
							}
						/>
						{!disabled && <DocumentMenuContent {...menuProps} />}
					</DropdownMenu>
				</td>
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
