import type { DocumentSort, DocumentSummary, DocumentTypeFilter } from "./filter";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { cn } from "@reactive-resume/utils/style";
import { LinkApplicationDialog, TagsDialog, useBatchActions } from "./document-actions";
import { DocumentCard, DocumentRow } from "./document-card";
import { LibraryError } from "./library-error";
import { PageNavigation } from "./page-navigation";
import { IMPORT_ACCEPT, useStartDocument } from "./use-start-document";
import { PageHeader } from "@/components/layout/page-header";
import { useDialogStore } from "@/dialogs/store";
import { isEditableElementFocused } from "@/features/resume/builder/draft";
import { orpc } from "@/libs/orpc/client";

export type DocumentsSearch = {
	type: DocumentTypeFilter;
	q: string;
	tags: string[];
	/** Only resumes whose public link is on. */
	public?: boolean | undefined;
	sort: DocumentSort;
	view?: "grid" | "list" | undefined;
};

type DocumentsPageProps = {
	search: DocumentsSearch;
	onSearchChange: (patch: Partial<DocumentsSearch>) => void;
};

/**
 * Documents: every resume and letter in one library, with type tabs, search (/), sort, grid or list, and tag
 * chips once tags exist. A file dropped anywhere on the page imports straight away.
 */
export function DocumentsPage({ search, onSearchChange }: DocumentsPageProps) {
	const openDialog = useDialogStore((state) => state.openDialog);
	const searchRef = useRef<HTMLInputElement>(null);
	const [tagsFor, setTagsFor] = useState<DocumentSummary[] | null>(null);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const [linkFor, setLinkFor] = useState<DocumentSummary | null>(null);
	// Grid and list animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);
	const searchText = search.q.slice(0, 500);
	const [query] = useDebounceValue(searchText, 300);
	const filterKey = JSON.stringify([search.type, searchText, search.tags, search.public, search.sort]);
	const [page, setPage] = useState({ filterKey, offset: 0, total: 0 });
	const offset = page.filterKey === filterKey ? page.offset : 0;
	const changePage = (next: number) => {
		setSelected(new Set());
		setPage({ filterKey, offset: next, total: pageData?.total ?? page.total });
	};
	const {
		data: pageData,
		isPending,
		isError,
		isFetching,
		isPlaceholderData,
		refetch,
	} = useQuery({
		gcTime: 0,
		placeholderData: (previous) => previous,
		...orpc.documents.page.queryOptions({
			input: {
				type: search.type,
				q: query,
				tags: search.tags,
				sort: search.sort,
				public: search.public ?? false,
				trashed: false,
				limit: 100,
				offset,
			},
		}),
	});
	const [lastPage, setLastPage] = useState({ data: pageData, offset });
	if (pageData && !isPlaceholderData && (pageData !== lastPage.data || offset !== lastPage.offset))
		setLastPage({ data: pageData, offset });
	const displayed = pageData ?? lastPage.data;
	const displayedOffset = pageData && !isPlaceholderData ? offset : lastPage.offset;
	const rowsCurrent = Boolean(pageData) && !isPlaceholderData && !isError && query === searchText;
	// The library staggers in on its first appearance only; cards that appear later (filters, a new document) don't.
	const [intro, setIntro] = useState(true);
	useEffect(() => {
		if (isPending) return;
		const timeout = setTimeout(() => setIntro(false), INTRO_MS);
		return () => clearTimeout(timeout);
	}, [isPending]);
	const view = search.view ?? readStoredView();
	const setView = (next: "grid" | "list") => {
		setViewSwitched(true);
		storeView(next);
		onSearchChange({ view: next });
	};
	const viewEnter =
		viewSwitched &&
		"transition-[opacity,translate] duration-standard ease-enter starting:translate-y-1 starting:opacity-0";

	useHotkey("/", (event) => {
		if (isEditableElementFocused()) return;
		event.preventDefault();
		searchRef.current?.focus();
	});

	if (page.filterKey !== filterKey || (pageData && !isPlaceholderData && offset > 0 && offset >= pageData.total)) {
		setPage({
			filterKey,
			total: pageData?.total ?? 0,
			offset: page.filterKey !== filterKey ? 0 : Math.max(0, Math.floor(((pageData?.total ?? 0) - 1) / 100) * 100),
		});
		setSelected(new Set());
		setTagsFor(null);
		setLinkFor(null);
	}

	const shown = displayed?.items ?? [];
	const failed = isError && !displayed;
	const filtered = search.type !== "all" || search.q.trim() !== "" || search.tags.length > 0 || search.public === true;
	const firstRun = rowsCurrent && !filtered && offset === 0 && pageData?.total === 0;
	const tags = displayed?.tags ?? [];
	const counts = {
		all: (displayed?.counts.resume ?? 0) + (displayed?.counts.letter ?? 0),
		resume: displayed?.counts.resume ?? 0,
		letter: displayed?.counts.letter ?? 0,
	};
	const hasPublic = displayed?.hasPublic ?? false;
	// Actions apply to the selected documents the filters show.
	const selection = rowsCurrent ? shown.filter((document) => selected.has(documentKey(document))) : [];
	const selecting = selection.length > 0;
	const allSelected = selecting && selection.length === shown.length;
	const setSelectedFor = (document: DocumentSummary, on: boolean) => {
		if (!rowsCurrent) return;
		setSelected((current) => {
			const next = new Set(current);
			if (on) next.add(documentKey(document));
			else next.delete(documentKey(document));
			return next;
		});
	};
	const selectAll = (on: boolean) => {
		if (on && !rowsCurrent) return;
		setSelected(new Set(on ? shown.map(documentKey) : []));
	};
	const itemProps = (document: DocumentSummary) => ({
		onTags: (document: DocumentSummary) => {
			if (rowsCurrent) setTagsFor([document]);
		},
		onLink: (document: DocumentSummary) => {
			if (rowsCurrent) setLinkFor(document);
		},
		selected: rowsCurrent && selected.has(documentKey(document)),
		disabled: !rowsCurrent,
		onSelectedChange: (on: boolean) => setSelectedFor(document, on),
		selecting,
	});

	useHotkey("Escape", () => {
		if (!selecting || tagsFor || linkFor || isEditableElementFocused()) return;
		selectAll(false);
	});

	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<PageHeader title={<Trans>Documents</Trans>}>
				{!firstRun && (
					<>
						<Tabs value={search.type} onValueChange={(type) => onSearchChange({ type: type as DocumentTypeFilter })}>
							<TabsList variant="line" aria-label={t`Document type`}>
								<TabsTrigger value="all">
									<Trans>All</Trans>
									<TabsCount>{counts.all}</TabsCount>
								</TabsTrigger>
								<TabsTrigger value="resume">
									<Trans>Resumes</Trans>
									<TabsCount>{counts.resume}</TabsCount>
								</TabsTrigger>
								<TabsTrigger value="letter">
									<Trans>Letters</Trans>
									<TabsCount>{counts.letter}</TabsCount>
								</TabsTrigger>
							</TabsList>
						</Tabs>

						<div className="ms-auto flex flex-wrap items-center gap-2 max-sm:ms-0 max-sm:w-full">
							<InputGroup className="w-60 max-sm:w-full">
								<InputGroupAddon>
									<Icon name="magnifying-glass" size={18} />
								</InputGroupAddon>
								<InputGroupInput
									ref={searchRef}
									type="search"
									value={searchText}
									maxLength={500}
									aria-label={t`Search documents`}
									placeholder={t`Search`}
									onChange={(event) => onSearchChange({ q: event.target.value.slice(0, 500) })}
								/>
								<InputGroupAddon align="inline-end" className="max-sm:hidden pointer-coarse:hidden">
									<Kbd>/</Kbd>
								</InputGroupAddon>
							</InputGroup>
							<div className="w-[150px]">
								<NativeSelect
									aria-label={t`Sort`}
									value={search.sort}
									onChange={(event) => onSearchChange({ sort: event.target.value as DocumentSort })}
								>
									<option value="edited">{t`Last edited`}</option>
									<option value="name">{t`Name`}</option>
									<option value="created">{t`Created`}</option>
								</NativeSelect>
							</div>
							<SegmentedControl
								aria-label={t`View`}
								value={view}
								onValueChange={(next) => setView(next as "grid" | "list")}
							>
								<SegmentedControlItem value="grid" aria-label={t`Grid`}>
									<Icon name="squares-four" size={18} />
								</SegmentedControlItem>
								<SegmentedControlItem value="list" aria-label={t`List`}>
									<Icon name="list-dashes" size={18} />
								</SegmentedControlItem>
							</SegmentedControl>
						</div>
					</>
				)}
			</PageHeader>

			{isError && (
				<div className="grid justify-items-start gap-2">
					<LibraryError retrying={isFetching} onRetry={() => void refetch()} />
					{filtered && (
						<Button variant="secondary" onClick={() => onSearchChange({ q: "", tags: [], type: "all", public: false })}>
							<Trans>Clear search and filters</Trans>
						</Button>
					)}
				</div>
			)}

			{failed ? null : firstRun ? (
				<FirstRun onFile={(file) => openDialog("document.new", { file })} />
			) : (
				<>
					{(tags.length > 0 || hasPublic) && (
						<TagFilter
							tags={tags}
							active={search.tags}
							onChange={(next) => onSearchChange({ tags: next })}
							showPublic={hasPublic}
							publicOnly={search.public ?? false}
							onPublicChange={(next) => onSearchChange({ public: next })}
						/>
					)}

					{isPending || (!rowsCurrent && !isError && shown.length === 0) ? (
						<LibrarySkeleton view={view} />
					) : shown.length === 0 ? (
						isError ? null : (
							<div className="grid justify-items-center gap-2 py-16 text-center">
								<Icon name="magnifying-glass" size={28} className="text-ink-3" />
								<p className="font-semibold">
									{search.q.trim() ? (
										<Trans>Nothing matches “{search.q.trim()}”</Trans>
									) : (
										<Trans>Nothing matches these filters</Trans>
									)}
								</p>
								<p className="text-sm text-ink-2">
									<Trans>Search covers titles, tags and linked applications.</Trans>
								</p>
								{filtered && (
									<Button
										variant="secondary"
										className="mt-2"
										onClick={() => onSearchChange({ q: "", tags: [], type: "all", public: false })}
									>
										<Trans>Clear search and filters</Trans>
									</Button>
								)}
							</div>
						)
					) : view === "list" ? (
						<table className={cn("w-full table-fixed border-collapse", viewEnter)}>
							<caption className="sr-only">
								<Trans>Documents</Trans>
							</caption>
							<thead>
								<tr className="border-b border-line text-start text-xs font-medium text-ink-3">
									<th className="w-10 ps-3">
										<Checkbox
											disabled={!rowsCurrent}
											checked={allSelected}
											indeterminate={selecting && !allSelected}
											onCheckedChange={(on) => selectAll(on)}
											aria-label={t`Select this page`}
										/>
									</th>
									<th className="h-10 ps-3 text-start font-medium">
										<Trans>Name</Trans>
									</th>
									<th className="w-24 px-2 text-start font-medium max-sm:hidden">
										<Trans>Type</Trans>
									</th>
									<th className="w-1/4 px-2 text-start font-medium max-sm:hidden">
										<Trans>Application</Trans>
									</th>
									<th className="w-28 px-2 text-start font-medium max-sm:w-24">
										<Trans>Edited</Trans>
									</th>
									<th className="w-12">
										<span className="sr-only">
											<Trans>Options</Trans>
										</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{shown.map((document, index) => (
									<DocumentRow
										key={documentKey(document)}
										document={document}
										introIndex={intro ? index : undefined}
										{...itemProps(document)}
									/>
								))}
							</tbody>
						</table>
					) : (
						<div
							className={cn(
								"grid grid-cols-[repeat(auto-fill,minmax(180px,204px))] gap-x-7 gap-y-[22px] max-sm:grid-cols-2 max-sm:gap-4",
								viewEnter,
							)}
						>
							{shown.map((document, index) => (
								<DocumentCard
									key={documentKey(document)}
									document={document}
									introIndex={intro ? index : undefined}
									{...itemProps(document)}
								/>
							))}
						</div>
					)}
				</>
			)}

			<PageNavigation
				offset={displayedOffset}
				total={displayed?.total ?? page.total}
				busy={isFetching || !rowsCurrent}
				onChange={changePage}
			/>
			<SelectionBar
				key={`selection:${filterKey}:${offset}`}
				selection={selection}
				allSelected={allSelected}
				onSelectAll={() => selectAll(true)}
				onClear={() => selectAll(false)}
				onTags={() => setTagsFor(selection)}
			/>
			<DropToImport />
			<TagsDialog
				key={`tags:${filterKey}:${offset}`}
				documents={rowsCurrent ? tagsFor : null}
				onClose={() => setTagsFor(null)}
			/>
			<LinkApplicationDialog
				key={`link:${filterKey}:${offset}`}
				document={rowsCurrent ? linkFor : null}
				onClose={() => setLinkFor(null)}
			/>
		</div>
	);
}

const documentKey = (document: DocumentSummary) => `${document.type}:${document.id}`;

const VIEW_KEY = "documents-view";
// Longest stagger (150ms) plus the D2 entrance (200ms), with room to spare: then the intro classes come off.
const INTRO_MS = 400;

// The last view picked on this device; storage can be unavailable, and then it's the grid.
function readStoredView(): "grid" | "list" {
	try {
		return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
	} catch {
		return "grid";
	}
}

function storeView(view: "grid" | "list") {
	try {
		window.localStorage.setItem(VIEW_KEY, view);
	} catch {
		// A convenience only.
	}
}

type FirstRunProps = { onFile: (file: File) => void };

/** The first visit: import is the filled button here, and only here. Choose a file opens the file picker itself. */
function FirstRun({ onFile }: FirstRunProps) {
	const { startBlank, trySample, creating } = useStartDocument();
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<section className="max-w-xl pt-4 transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0">
			<input
				ref={inputRef}
				type="file"
				accept={IMPORT_ACCEPT}
				className="hidden"
				aria-label={t`Choose a file to import`}
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) onFile(file);
				}}
			/>
			<EmptyState
				title={<Trans>Let's start with what you have</Trans>}
				description={
					<Trans>
						Import your current resume and we'll lay out every section for you to refine, or start fresh. Drop a PDF,
						Word or JSON file anywhere here.
					</Trans>
				}
				action={
					<Button onClick={() => inputRef.current?.click()}>
						<Icon name="file-arrow-up" size={18} />
						<Trans>Choose a file</Trans>
					</Button>
				}
				secondary={
					<>
						<Button
							variant="link"
							disabled={creating}
							className="text-ink-2 underline underline-offset-2 hover:text-ink pointer-coarse:min-h-11"
							onClick={() => void startBlank()}
						>
							<Trans>Start blank</Trans>
						</Button>
						<Button
							variant="link"
							disabled={creating}
							className="text-ink-2 underline underline-offset-2 hover:text-ink pointer-coarse:min-h-11"
							onClick={() => void trySample()}
						>
							<Trans>Try a sample</Trans>
						</Button>
					</>
				}
			/>
		</section>
	);
}

type TagFilterProps = {
	tags: string[];
	active: string[];
	onChange: (tags: string[]) => void;
	/** Public appears first once any resume's link is on. */
	showPublic: boolean;
	publicOnly: boolean;
	onPublicChange: (publicOnly: boolean) => void;
};

const chipClassName = (isActive: boolean) =>
	cn(
		"min-h-7 rounded-sm border px-3 text-[13px] transition-[background-color,border-color,color,scale] duration-quick ease-enter active:scale-[0.97] pointer-coarse:min-h-11",
		isActive ? "border-accent bg-accent-soft text-accent-text" : "border-line-2 text-ink-2 hover:bg-hover",
	);

function TagFilter({ tags, active, onChange, showPublic, publicOnly, onPublicChange }: TagFilterProps) {
	return (
		<fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
			<legend className="sr-only">
				<Trans>Filter by tag</Trans>
			</legend>
			{showPublic && (
				<button
					type="button"
					aria-pressed={publicOnly}
					onClick={() => onPublicChange(!publicOnly)}
					className={cn(chipClassName(publicOnly), "inline-flex items-center gap-1")}
				>
					<Icon name="globe" size={14} />
					<Trans>Public</Trans>
				</button>
			)}
			{tags.map((tag) => {
				const isActive = active.includes(tag);
				return (
					<button
						key={tag}
						type="button"
						aria-pressed={isActive}
						onClick={() => onChange(isActive ? active.filter((known) => known !== tag) : [...active, tag].slice(0, 20))}
						className={chipClassName(isActive)}
					>
						#{tag}
					</button>
				);
			})}
		</fieldset>
	);
}

type SelectionBarProps = {
	selection: DocumentSummary[];
	allSelected: boolean;
	onSelectAll: () => void;
	onClear: () => void;
	onTags: () => void;
};

/** Floats over the library while documents are selected: tags, visibility, locking and Trash for all of them. */
function SelectionBar({ selection, allSelected, onSelectAll, onClear, onTags }: SelectionBarProps) {
	const batch = useBatchActions();
	const [busy, setBusy] = useState(false);
	const count = selection.length;
	const run = async (action: () => Promise<unknown>, { clear = false } = {}) => {
		if (!selection.length) return;
		setBusy(true);
		try {
			await action();
			if (clear) onClear();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			role="toolbar"
			aria-label={t`Selected documents`}
			aria-hidden={count === 0}
			inert={count === 0}
			className={cn(
				"fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit max-w-[calc(100vw-32px)] items-center gap-1 rounded-xl border border-line bg-raised p-1.5 shadow-e3 transition-[opacity,translate] duration-standard ease-enter max-sm:bottom-4",
				count === 0 && "pointer-events-none translate-y-2 opacity-0",
			)}
		>
			<span className="px-2 text-sm font-semibold whitespace-nowrap" aria-live="polite">
				<Trans>{count} selected</Trans>
			</span>
			{!allSelected && (
				<Button variant="ghost" size="sm" onClick={onSelectAll} className="max-sm:hidden">
					<Trans>Select this page</Trans>
				</Button>
			)}
			<Button variant="ghost" size="sm" disabled={busy} onClick={onTags}>
				<Icon name="tag" />
				<span className="max-sm:sr-only">
					<Trans>Tags</Trans>
				</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button variant="ghost" size="sm" disabled={busy}>
							<Icon name="globe" />
							<span className="max-sm:sr-only">
								<Trans>Sharing</Trans>
							</span>
							<Icon name="caret-down" size={14} />
						</Button>
					}
				/>
				<DropdownMenuContent side="top" align="center" className="w-48">
					<DropdownMenuItem onClick={() => void run(() => batch.setPublic(selection, true))}>
						<Icon name="globe" />
						<Trans>Make public</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void run(() => batch.setPublic(selection, false))}>
						<Icon name="eye-slash" />
						<Trans>Make private</Trans>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => void run(() => batch.setLocked(selection, true))}>
						<Icon name="lock" />
						<Trans>Lock editing</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => void run(() => batch.setLocked(selection, false))}>
						<Icon name="lock-open" />
						<Trans>Unlock</Trans>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				className="text-danger-text hover:bg-danger-soft"
				onClick={() => void run(() => batch.trash(selection), { clear: true })}
			>
				<Icon name="trash" />
				<span className="max-sm:sr-only">
					<Trans>Move to Trash</Trans>
				</span>
			</Button>
			<IconButton icon="x" size="icon-sm" label={t`Clear selection`} className="text-ink-2" onClick={onClear} />
		</div>
	);
}

function LibrarySkeleton({ view }: { view: "grid" | "list" }) {
	if (view === "list") {
		return (
			<div className="grid">
				<div className="h-10 border-b border-line" />
				{Array.from({ length: 6 }, (_, index) => (
					<div key={index} className="flex h-[45px] items-center border-b border-line ps-3">
						<Skeleton className="h-4 w-1/3" />
					</div>
				))}
			</div>
		);
	}
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(180px,204px))] gap-x-7 gap-y-[22px] max-sm:grid-cols-2 max-sm:gap-4">
			{Array.from({ length: 6 }, (_, index) => (
				<div key={index} className="grid gap-2">
					<Skeleton className="aspect-page rounded-md" />
					<Skeleton className="h-4 w-3/4 rounded" />
				</div>
			))}
		</div>
	);
}

/** A file dragged anywhere over the page shows the drop target, and dropping it starts the import. */
function DropToImport() {
	const openDialog = useDialogStore((state) => state.openDialog);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		let depth = 0;
		const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
		const onEnter = (event: DragEvent) => {
			if (!hasFiles(event)) return;
			depth += 1;
			setDragging(true);
		};
		const onLeave = () => {
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDragging(false);
		};
		const onOver = (event: DragEvent) => {
			if (hasFiles(event)) event.preventDefault();
		};
		const onDrop = (event: DragEvent) => {
			depth = 0;
			setDragging(false);
			const file = event.dataTransfer?.files[0];
			if (!file) return;
			event.preventDefault();
			// A drop inside an open dialog is that dialog's to handle.
			if (useDialogStore.getState().open) return;
			openDialog("document.new", { file });
		};

		window.addEventListener("dragenter", onEnter);
		window.addEventListener("dragleave", onLeave);
		window.addEventListener("dragover", onOver);
		window.addEventListener("drop", onDrop);
		return () => {
			window.removeEventListener("dragenter", onEnter);
			window.removeEventListener("dragleave", onLeave);
			window.removeEventListener("dragover", onOver);
			window.removeEventListener("drop", onDrop);
		};
	}, [openDialog]);

	return (
		<div
			aria-hidden={!dragging}
			className={cn(
				"pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/80 transition-[opacity,visibility] ease-enter",
				dragging ? "visible opacity-100 duration-standard" : "invisible opacity-0 duration-[calc(var(--d2)*0.7)]",
			)}
		>
			<div className="grid justify-items-center gap-2 text-center">
				<Icon name="download-simple" size={32} className="text-accent-text" />
				<p className="text-lg font-semibold">
					<Trans>Drop to import</Trans>
				</p>
				<p className="text-sm text-ink-2">
					<Trans>PDF, Word or JSON. We'll build a resume from it.</Trans>
				</p>
			</div>
		</div>
	);
}
