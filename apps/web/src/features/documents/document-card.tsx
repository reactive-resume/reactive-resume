import type { DocumentSummary } from "./filter";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { ContextMenu, ContextMenuTrigger } from "@reactive-resume/ui/components/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { cn } from "@reactive-resume/utils/style";
import { DocumentMenuContent, useDocumentActions } from "./document-actions";
import { daysLeftInTrash } from "./filter";
import { useNewDocumentsStore } from "./new-documents";
import { ResumeThumbnail } from "./resume-thumbnail";
import { isImeComposing } from "@/libs/keyboard";
import { formatRelativeTime } from "@/libs/locale";
import { ENTER_CLASS, stagger } from "@/libs/motion";

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
	return t`${type} · Edited ${formatRelativeTime(document.editedAt, i18n.locale)}`;
}

/** Opens the document in its editor: resumes and letters share the editor shell. */
function OpenLink({
	document,
	className,
	children,
	label,
	onSelect,
	disabled,
}: Pick<DocumentItemProps, "document" | "disabled"> & {
	className?: string;
	children: React.ReactNode;
	label?: string;
	/** While selecting, a click toggles the document instead of opening it. */
	onSelect?: (() => void) | undefined;
}) {
	const markOpened = useNewDocumentsStore((state) => state.markOpened);
	if (document.trashedAt || disabled)
		return (
			<span aria-disabled={disabled} className={className}>
				{children}
			</span>
		);
	const onClick = (event: React.MouseEvent) => {
		if (!onSelect) return markOpened(document.id);
		event.preventDefault();
		onSelect();
	};
	const common = { "aria-label": label, className, onClick };

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
	const [value, setValue] = useState(document.name);
	const commit = () => {
		actions.rename(document, value);
		onDone();
	};

	return (
		<input
			// oxlint-disable-next-line jsx-a11y/no-autofocus -- renaming starts from the menu, so focus goes straight to the field.
			autoFocus
			value={value}
			maxLength={100}
			aria-label={t`Name`}
			onChange={(event) => setValue(event.target.value)}
			onFocus={(event) => event.target.select()}
			onBlur={commit}
			onKeyDown={(event) => {
				if (isImeComposing(event)) return;
				if (event.key === "Enter") commit();
				if (event.key === "Escape") {
					event.stopPropagation();
					onDone();
				}
			}}
			className="h-7 w-full min-w-0 rounded-md border border-accent bg-raised px-1.5 text-sm font-semibold ring-3 ring-accent-soft outline-none"
		/>
	);
}

/** A letter's page, drawn from lines (letters have no thumbnail render), addressed to its recipient once there is one. */
function LetterThumbnail({ name, recipient }: { name: string; recipient: string | null }) {
	return (
		<div aria-hidden="true" className="flex size-full flex-col gap-1.5 bg-white p-[14%] text-[0]">
			<span className="h-1.5 w-2/5 rounded-sm bg-[#c9c9c9]" />
			{recipient ? (
				<span className="mb-2 truncate text-[11px] leading-4 font-semibold text-[#3a3a3a]">{recipient}</span>
			) : (
				<span className="mb-3 h-1 w-3/5 rounded-sm bg-[#e2e2e2]" />
			)}
			<span className="h-1 w-1/3 rounded-sm bg-[#d4d4d4]" />
			{Array.from({ length: 7 }, (_, index) => (
				<span key={index} className={cn("h-1 rounded-sm bg-[#e6e6e6]", index % 3 === 2 ? "w-4/5" : "w-full")} />
			))}
			<span className="mt-2 h-1 w-1/4 rounded-sm bg-[#d4d4d4]" />
			<span className="sr-only">{name}</span>
		</div>
	);
}

/** A status chip on the page thumbnail. The page is white in both themes, so the chip doesn't follow the theme. */
function PaperBadge({ icon, label }: { icon: "globe" | "lock"; label: string }) {
	return (
		<span className="grid size-[22px] place-items-center rounded bg-black/75 text-white" title={label}>
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
	const [renaming, setRenaming] = useState(false);
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
						style={introIndex === undefined ? undefined : stagger(introIndex)}
						className={cn(
							"group/card grid gap-2",
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
						onSelect={selecting && onSelectedChange ? () => onSelectedChange(!selected) : undefined}
						className={cn(
							"relative block aspect-page overflow-hidden rounded-md shadow-[0_0_0_1px_var(--line),var(--shadow-1)] transition-[translate,scale,box-shadow] duration-quick ease-enter hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_var(--line),var(--shadow-2)] active:scale-[0.98]",
							(isNew || selected) &&
								"shadow-[0_0_0_2px_var(--accent),var(--shadow-1)] hover:shadow-[0_0_0_2px_var(--accent),var(--shadow-2)] starting:shadow-[0_0_0_2px_transparent,var(--shadow-1)]",
							document.trashedAt && "pointer-events-none",
						)}
					>
						{document.type === "resume" ? (
							<ResumeThumbnail resume={document} />
						) : (
							<LetterThumbnail name={document.name} recipient={document.recipient} />
						)}
						<span className="absolute start-2 top-2 flex gap-1">
							{isNew && (
								<span className="rounded bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent">
									<Trans>New</Trans>
								</span>
							)}
							{document.isPublic && <PaperBadge icon="globe" label={t`Public`} />}
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
							<h3 className="truncate text-sm leading-5 font-semibold">{document.name}</h3>
						)}
						<span className="truncate text-xs text-ink-3">{meta}</span>
						{document.application ? (
							<span className="flex min-w-0 items-center gap-1 text-xs text-ink-2">
								<Icon name="briefcase" size={14} />
								<span className="truncate">{document.application.company}</span>
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
	const [renaming, setRenaming] = useState(false);
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
								className="min-w-0 truncate text-start text-sm font-semibold hover:underline"
							>
								{document.name}
							</OpenLink>
						)}
						{isNew && (
							<span className="rounded bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-on-accent">
								<Trans>New</Trans>
							</span>
						)}
						{document.isPublic && (
							<span title={t`Public`} className="shrink-0 text-ink-3">
								<Icon name="globe" size={16} />
								<span className="sr-only">
									<Trans>Public</Trans>
								</span>
							</span>
						)}
						{document.isLocked && <Icon name="lock" size={16} className="shrink-0 text-ink-3" />}
					</span>
				</td>
				<td className="px-2 text-sm text-ink-2 max-sm:hidden">
					{document.type === "resume" ? <Trans>Resume</Trans> : <Trans>Letter</Trans>}
				</td>
				<td className="truncate px-2 text-sm text-ink-2 max-sm:hidden">{document.application?.company ?? "—"}</td>
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
