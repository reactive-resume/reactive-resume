import type { DocumentSort, DocumentSummary, DocumentTypeFilter } from "./filter";
import type { QueryClient } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { LinkApplicationDialog, TagsDialog, useBatchActions } from "./document-actions";
import { DocumentCard, DocumentRow } from "./document-card";
import { documentKey } from "./filter";
import { LibraryError } from "./library-error";
import { useDocumentHistory } from "./library-session";
import { useNewDocumentsStore } from "./new-documents";
import { PageNavigation } from "./page-navigation";
import { useDocumentRemovalMotion } from "./removal-motion";
import { IMPORT_ACCEPT, useStartDocument } from "./use-start-document";
import {
	DataTable,
	DataTableBody,
	DataTableHead,
	DataTableHeaderCell,
	DataTableRow,
} from "@/components/calm/data-table";
import { Chip, FilterBar, FilterField } from "@/components/calm/filter-bar";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { SelectionBar } from "@/components/calm/selection-bar";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { useDialogStore } from "@/dialogs/store";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";
import { useShortcutsPage } from "@/features/keyboard-shortcuts/store";
import { isEditableElementFocused } from "@/features/resume/builder/draft";
import { isImeComposing } from "@/libs/keyboard";
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
 * Documents: every resume and letter in one library, with type tabs, a filter (/), chips from the data, sort, and
 * a grid or a list. A file dropped anywhere on the page opens import confirmation.
 */
export function DocumentsPage({ search, onSearchChange }: DocumentsPageProps) {
	const { t } = useLingui();
	useShortcutsPage(t`Documents`);
	const openDialog = useDialogStore((state) => state.openDialog);
	const searchRef = useRef<HTMLInputElement>(null);
	const resultsRef = useRef<HTMLTableElement & HTMLDivElement>(null);
	const queryClient = useQueryClient();
	const openOnResults = useRef<{ request: string; client: QueryClient } | null>(null);
	const router = useRouter();
	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ pathChanged }) => {
				if (pathChanged) openOnResults.current = null;
			}),
		[router],
	);
	const searchHintId = useId();
	const navigate = useNavigate();
	const markOpened = useNewDocumentsStore((state) => state.markOpened);
	const [tagsFor, setTagsFor] = useState<DocumentSummary[] | null>(null);
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const clearSelection = useCallback(() => setSelected(new Set()), []);
	const [linkFor, setLinkFor] = useState<DocumentSummary | null>(null);
	// Grid and list animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);
	const searchText = search.q.slice(0, 500);
	const [query, setQuery] = useDebounceValue(searchText, 300);
	const filterKey = JSON.stringify([search.type, searchText, search.tags, search.public ?? false, search.sort]);
	const [page, setPage] = useState({ filterKey, offset: 0, total: 0 });
	const offset = page.filterKey === filterKey ? page.offset : 0;
	const changePage = (next: number) => {
		setSelected(new Set());
		setPage({ filterKey, offset: next, total: pageData?.total ?? page.total });
	};
	const input = {
		type: search.type,
		q: searchText,
		tags: search.tags,
		sort: search.sort,
		public: search.public ?? false,
		trashed: false,
		limit: 100,
		offset,
	};
	// Bind Enter to its intended request, including text not yet released by the debounce.
	const request = JSON.stringify(input);
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
			input: { ...input, q: query },
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
	const phone = useBreakpoint() === "mobile";
	const view = search.view ?? readStoredView() ?? (phone ? "list" : "grid");
	const setView = (next: "grid" | "list") => {
		setViewSwitched(true);
		storeView(next);
		onSearchChange({ view: next });
	};
	const viewEnter =
		viewSwitched &&
		"transition-[opacity,translate] duration-standard ease-enter starting:translate-y-1 starting:opacity-0";

	useDocumentRemovalMotion({
		container: resultsRef,
		scope: JSON.stringify([filterKey, displayedOffset, view]),
		trashed: false,
		data: displayed,
		fetching: isFetching,
		failed: isError,
	});

	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	useHotkey(
		"/",
		(event) => {
			if (isEditableElementFocused()) return;
			event.preventDefault();
			searchRef.current?.focus();
		},
		{ enabled: characterShortcuts, meta: { name: t`Filter documents` } },
	);

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
	const shownIndex = new Map(shown.map((document, index) => [documentKey(document), index]));
	const failed = isError && !displayed;
	const filtered = search.type !== "all" || search.q.trim() !== "" || search.tags.length > 0 || search.public === true;
	const {
		data: libraryCounts,
		isPending: countsPending,
		isError: countsError,
		isFetching: countsFetching,
		refetch: refetchCounts,
	} = useQuery(orpc.documents.counts.queryOptions());
	const trashCount = libraryCounts?.trash ?? 0;
	const hadDocuments = useDocumentHistory(
		shown.length > 0 || (libraryCounts ? libraryCounts.resume + libraryCounts.letter + libraryCounts.trash > 0 : false),
	);
	const firstRun = rowsCurrent && !filtered && offset === 0 && pageData?.total === 0 && !hadDocuments;
	const tags = displayed?.tags ?? [];
	const counts = {
		all: (displayed?.counts.resume ?? 0) + (displayed?.counts.letter ?? 0),
		resume: displayed?.counts.resume ?? 0,
		letter: displayed?.counts.letter ?? 0,
	};
	const hasPublic = displayed?.hasPublic ?? false;
	// A type tab with nothing of its kind is empty, not filtered: it offers to make one.
	const emptyType =
		search.type !== "all" &&
		search.q.trim() === "" &&
		search.tags.length === 0 &&
		search.public !== true &&
		offset === 0 &&
		counts[search.type] === 0
			? search.type
			: null;
	// A job with more than one document here gets a chip, in place of the group headings the library had.
	// The chip narrows by the job's name through the filter text; an exact filter needs an application filter on
	// `documents.page` (API).
	const jobs = [
		...new Map(shown.flatMap((item) => (item.application ? [[item.application.id, item.application]] : []))).values(),
	]
		.filter((job) => shown.filter((item) => item.application?.id === job.id).length > 1)
		.slice(0, 3);
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

	const openDocument = (document: DocumentSummary) => {
		markOpened(document.id);
		if (document.type === "resume") void navigate({ to: "/builder/$resumeId", params: { resumeId: document.id } });
		else void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: document.id } });
	};

	// Replacement requests cannot inherit an earlier Enter, even when their search text is identical.
	useEffect(() => {
		const pending = openOnResults.current;
		if (pending === null) return;
		if (pending.request !== request || pending.client !== queryClient || isError) {
			openOnResults.current = null;
			return;
		}
		if (!rowsCurrent) return;
		openOnResults.current = null;
		const first = shown[0];
		if (first) openDocument(first);
	});

	// The search field is keyboard-complete: Enter opens the top result, ↓ moves into the results, Esc clears, then leaves.
	const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (isImeComposing(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key === "Enter") {
			event.preventDefault();
			openOnResults.current = null;
			if (!searchText.trim() || (isError && query === searchText)) return;
			const first = shown[0];
			if (rowsCurrent) {
				if (first) openDocument(first);
				return;
			}
			openOnResults.current = { request, client: queryClient };
			// Skip the typing delay: search for what's in the field now.
			setQuery.flush();
		} else if (event.key === "ArrowDown") {
			openOnResults.current = null;
			const first = resultsRef.current?.querySelector<HTMLElement>("a[href]");
			if (!first) return;
			event.preventDefault();
			first.focus();
		} else if (event.key === "Escape") {
			event.preventDefault();
			openOnResults.current = null;
			if (searchText) onSearchChange({ q: "" });
			else event.currentTarget.blur();
		}
	};

	const sortLabels: Record<DocumentSort, string> = { edited: t`Last edited`, name: t`Name`, created: t`Created` };
	const clearFilters = () => onSearchChange({ q: "", tags: [], type: "all", public: false });

	return (
		<Page>
			{/* The grid's cards and the table end the page themselves; the margin keeps the selection bar's anchor at the window's edge. */}
			<PageBody className="mb-12 pb-0">
				<RootHeader
					title={<Trans>Documents</Trans>}
					actions={
						<>
							{!firstRun && (
								<>
									<Button
										variant="ghost"
										nativeButton={false}
										render={<Link to="/dashboard/documents/import" />}
										className="max-sm:hidden"
									>
										<Icon name="upload-simple" />
										<Trans>Import</Trans>
									</Button>
									{/* The page's one accent button. New document's dialog returns focus here. */}
									<Button
										aria-label={t`New document`}
										className={cn("max-sm:size-11 max-sm:p-0", rowsCurrent && shown.length === 0 && "hidden")}
										data-document-new-trigger
										onClick={() => openDialog("document.new", undefined)}
									>
										<Icon name="plus" />
										<span className="max-sm:hidden">
											<Trans>New document</Trans>
										</span>
									</Button>
								</>
							)}
							<PhoneHeaderActions />
						</>
					}
				/>

				{!firstRun && (
					<>
						<Tabs
							value={search.type}
							onValueChange={(type) => onSearchChange({ type: type as DocumentTypeFilter })}
							className="mt-4"
						>
							<TabsList variant="line" aria-label={t`Document type`} className="w-full justify-start">
								<TabsTrigger value="all">
									<Trans>All</Trans>
									<TabsCount>{i18n.number(counts.all)}</TabsCount>
								</TabsTrigger>
								<TabsTrigger value="resume">
									<Trans>Resumes</Trans>
									<TabsCount>{i18n.number(counts.resume)}</TabsCount>
								</TabsTrigger>
								<TabsTrigger value="letter">
									<Trans>Letters</Trans>
									<TabsCount>{i18n.number(counts.letter)}</TabsCount>
								</TabsTrigger>
							</TabsList>
						</Tabs>

						<FilterBar
							end={
								<>
									{/* Phones: sort, view and the chips share one button beside the filter (M1). */}
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<IconButton
													icon="sliders-horizontal"
													variant="secondary"
													label={t`Sort, view and filters`}
													className="size-11 sm:hidden"
												/>
											}
										/>
										<DropdownMenuContent align="end">
											<DropdownMenuGroup>
												<DropdownMenuLabel>
													<Trans>Sort</Trans>
												</DropdownMenuLabel>
												<DropdownMenuRadioGroup
													value={search.sort}
													onValueChange={(sort) => onSearchChange({ sort: sort as DocumentSort })}
												>
													{(Object.keys(sortLabels) as DocumentSort[]).map((sort) => (
														<DropdownMenuRadioItem key={sort} value={sort}>
															{sortLabels[sort]}
														</DropdownMenuRadioItem>
													))}
												</DropdownMenuRadioGroup>
											</DropdownMenuGroup>
											<DropdownMenuSeparator />
											<DropdownMenuGroup>
												<DropdownMenuLabel>
													<Trans>View</Trans>
												</DropdownMenuLabel>
												<DropdownMenuRadioGroup value={view} onValueChange={(next) => setView(next as "grid" | "list")}>
													<DropdownMenuRadioItem value="list">
														<Trans>Rows</Trans>
													</DropdownMenuRadioItem>
													<DropdownMenuRadioItem value="grid">
														<Trans>Grid</Trans>
													</DropdownMenuRadioItem>
												</DropdownMenuRadioGroup>
											</DropdownMenuGroup>
											{(hasPublic || tags.length > 0 || jobs.length > 0) && (
												<>
													<DropdownMenuSeparator />
													<DropdownMenuGroup>
														<DropdownMenuLabel>
															<Trans>Show</Trans>
														</DropdownMenuLabel>
														{hasPublic && (
															<DropdownMenuCheckboxItem
																checked={search.public ?? false}
																onCheckedChange={(on) => onSearchChange({ public: on })}
															>
																<Trans>Public</Trans>
															</DropdownMenuCheckboxItem>
														)}
														{tags.map((tag) => (
															<DropdownMenuCheckboxItem
																key={tag}
																checked={search.tags.includes(tag)}
																onCheckedChange={(on) =>
																	onSearchChange({
																		tags: on
																			? [...search.tags, tag].slice(0, 20)
																			: search.tags.filter((known) => known !== tag),
																	})
																}
															>
																#{tag}
															</DropdownMenuCheckboxItem>
														))}
														{jobs.map((job) => (
															<DropdownMenuCheckboxItem
																key={job.id}
																checked={search.q.trim() === job.company}
																onCheckedChange={(on) => onSearchChange({ q: on ? job.company : "" })}
															>
																<Trans comment="A filter chip: the documents for one job">For {job.company}</Trans>
															</DropdownMenuCheckboxItem>
														))}
													</DropdownMenuGroup>
												</>
											)}
										</DropdownMenuContent>
									</DropdownMenu>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													variant="ghost"
													aria-label={t`Sort: ${sortLabels[search.sort]}`}
													className="max-sm:hidden"
												>
													<Icon name="arrows-down-up" />
													{sortLabels[search.sort]}
													<Icon name="caret-down" />
												</Button>
											}
										/>
										<DropdownMenuContent align="end">
											<DropdownMenuRadioGroup
												value={search.sort}
												onValueChange={(sort) => onSearchChange({ sort: sort as DocumentSort })}
											>
												{(Object.keys(sortLabels) as DocumentSort[]).map((sort) => (
													<DropdownMenuRadioItem key={sort} value={sort}>
														{sortLabels[sort]}
													</DropdownMenuRadioItem>
												))}
											</DropdownMenuRadioGroup>
										</DropdownMenuContent>
									</DropdownMenu>
									<SegmentedControl
										className="max-sm:hidden"
										aria-label={t`View`}
										value={view}
										onValueChange={(next) => setView(next as "grid" | "list")}
									>
										<SegmentedControlItem value="grid" aria-label={t`Grid`} className="px-2.5">
											<Icon name="squares-four" />
										</SegmentedControlItem>
										<SegmentedControlItem value="list" aria-label={t`List`} className="px-2.5">
											<Icon name="list" />
										</SegmentedControlItem>
									</SegmentedControl>
								</>
							}
						>
							{/* No board draws a clear button on the filter: Esc clears it. */}
							<FilterField
								ref={searchRef}
								label={t`Filter documents`}
								className="max-sm:w-auto max-sm:min-w-0 max-sm:flex-1 max-sm:shrink max-sm:[&_kbd]:hidden"
								{...(characterShortcuts && !searchText ? { shortcut: "/" } : {})}
								value={searchText}
								maxLength={500}
								aria-describedby={searchHintId}
								enterKeyHint="go"
								onChange={(event) => onSearchChange({ q: event.target.value.slice(0, 500) })}
								onKeyDown={onSearchKeyDown}
							/>
							<span id={searchHintId} className="sr-only">
								<Trans>Enter opens the first result. Down arrow moves to the results. Escape clears.</Trans>
							</span>
							{/* Desktop: the chips follow the field. Tablets: their own line under the field, sort and view (M2).
							    Phones: inside the one button. */}
							<div className="flex flex-wrap items-center gap-2 max-lg:order-last max-lg:w-full max-sm:hidden lg:contents">
								{/* Chips come from the data: Public once any link is on, the tags in use, a job with several documents. */}
								{hasPublic && (
									<Chip
										pressed={search.public ?? false}
										className="lg:ms-2"
										onClick={() => onSearchChange({ public: !search.public })}
									>
										<Icon name="globe-simple" size={16} />
										<Trans>Public</Trans>
									</Chip>
								)}
								{tags.map((tag) => {
									const isActive = search.tags.includes(tag);
									return (
										<Chip
											key={tag}
											pressed={isActive}
											onClick={() =>
												onSearchChange({
													tags: isActive
														? search.tags.filter((known) => known !== tag)
														: [...search.tags, tag].slice(0, 20),
												})
											}
										>
											#{tag}
										</Chip>
									);
								})}
								{jobs.map((job) => {
									const isActive = search.q.trim() === job.company;
									return (
										<Chip
											key={job.id}
											pressed={isActive}
											onClick={() => onSearchChange({ q: isActive ? "" : job.company })}
										>
											<Icon name="briefcase" size={16} />
											<Trans comment="A filter chip: the documents for one job">For {job.company}</Trans>
										</Chip>
									);
								})}
							</div>
						</FilterBar>
					</>
				)}

				{(isError || countsError) && (
					<div className="mt-4 grid justify-items-start gap-2">
						<LibraryError
							retrying={isFetching || countsFetching}
							onRetry={() => {
								void refetch();
								void refetchCounts();
							}}
						/>
						{filtered && (
							<Button variant="secondary" onClick={clearFilters}>
								<Trans>Clear search and filters</Trans>
							</Button>
						)}
					</div>
				)}

				{failed ? null : firstRun && trashCount === 0 && libraryCounts ? (
					<FirstRun trashCount={trashCount} onFile={(file) => openDialog("document.new", { file })} />
				) : isPending || (firstRun && countsPending) || (!rowsCurrent && !isError && shown.length === 0) ? (
					<LibrarySkeleton view={view} />
				) : shown.length === 0 ? (
					isError ? null : !filtered && offset === 0 ? (
						<EmptyState
							className="mt-5"
							title={<Trans>No documents</Trans>}
							description={
								trashCount > 0 ? (
									<Plural value={trashCount} one="Trash has # document." other="Trash has # documents." />
								) : undefined
							}
						/>
					) : emptyType ? (
						<TypeEmpty type={emptyType} />
					) : (
						<EmptyState
							className="mt-5"
							title={
								search.q.trim() ? (
									<Trans>Nothing matches “{search.q.trim()}”</Trans>
								) : (
									<Trans>Nothing matches these filters</Trans>
								)
							}
							description={<Trans>Search covers titles, tags and linked applications.</Trans>}
							action={
								filtered ? (
									<Button variant="secondary" onClick={clearFilters}>
										<Trans>Clear search and filters</Trans>
									</Button>
								) : undefined
							}
						/>
					)
				) : view === "list" ? (
					<DataTable
						ref={resultsRef}
						aria-label={t`Documents`}
						columns="var(--cols)"
						className={cn(
							"mt-3 [--cols:minmax(0,1fr)_44px] sm:[--cols:36px_minmax(0,1.7fr)_104px_minmax(0,1fr)_132px_28px]",
							viewEnter,
						)}
					>
						<DataTableHead className="max-sm:hidden">
							<DataTableRow variant="header">
								<DataTableHeaderCell className="justify-center">
									<Checkbox
										disabled={!rowsCurrent}
										checked={allSelected}
										indeterminate={selecting && !allSelected}
										onCheckedChange={(on) => selectAll(on)}
										aria-label={t`Select this page`}
									/>
								</DataTableHeaderCell>
								<DataTableHeaderCell>
									<Trans>Name</Trans>
								</DataTableHeaderCell>
								<DataTableHeaderCell className="max-sm:hidden">
									<Trans>Type</Trans>
								</DataTableHeaderCell>
								<DataTableHeaderCell className="max-sm:hidden">
									<Trans>Application</Trans>
								</DataTableHeaderCell>
								<DataTableHeaderCell
									className="text-ink-3"
									{...(search.sort === "edited" ? { sort: "descending" as const } : {})}
								>
									<Trans>Edited</Trans>
								</DataTableHeaderCell>
								<DataTableHeaderCell>
									<span className="sr-only">
										<Trans>Options</Trans>
									</span>
								</DataTableHeaderCell>
							</DataTableRow>
						</DataTableHead>
						<DataTableBody>
							{shown.map((document) => (
								<DocumentRow
									key={documentKey(document)}
									document={document}
									introIndex={intro ? shownIndex.get(documentKey(document)) : undefined}
									{...itemProps(document)}
								/>
							))}
						</DataTableBody>
					</DataTable>
				) : (
					<div ref={resultsRef} className={cn(GRID_CLASS, viewEnter)}>
						{shown.map((document) => (
							<DocumentCard
								key={documentKey(document)}
								document={document}
								introIndex={intro ? shownIndex.get(documentKey(document)) : undefined}
								{...itemProps(document)}
							/>
						))}
					</div>
				)}

				<TrashLink />
				<PageNavigation
					offset={displayedOffset}
					total={displayed?.total ?? page.total}
					busy={isFetching || !rowsCurrent}
					onChange={changePage}
				/>
			</PageBody>
			{selecting && (
				// Bottom centre of the window's main column, over the list, however far the page has scrolled.
				<div className="sticky bottom-0 z-20 mt-auto h-0 max-sm:bottom-(--app-tabbar)">
					<DocumentsSelectionBar
						key={`selection:${filterKey}:${offset}`}
						selection={selection}
						total={shown.length}
						onSelectAll={() => selectAll(true)}
						onClear={clearSelection}
						onTags={() => setTagsFor(selection)}
					/>
				</div>
			)}
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
		</Page>
	);
}

const VIEW_KEY = "documents-view";
// Longest stagger (150ms) plus the D2 entrance (200ms), with room to spare: then the intro classes come off.
const INTRO_MS = 400;
// Two to a row on phones, three from 640, four from 1280 (BUILD.md §3.14). Cards span four rows of the grid.
const GRID_CLASS = "mt-5 grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-6 xl:grid-cols-4";

// The last view picked on this device; storage can be unavailable, and then it's the grid.
function readStoredView(): "grid" | "list" | null {
	try {
		const stored = window.localStorage.getItem(VIEW_KEY);
		return stored === "list" || stored === "grid" ? stored : null;
	} catch {
		return null;
	}
}

function storeView(view: "grid" | "list") {
	try {
		window.localStorage.setItem(VIEW_KEY, view);
	} catch {
		// A convenience only.
	}
}

type FirstRunProps = {
	onFile: (file: File) => void;
	/** Everything may be in Trash (often the last document, just moved there): the way back stays in sight. */
	trashCount: number;
};

/** The first visit: import is the filled button here, and only here. Choose a file opens the file picker itself. */
function FirstRun({ onFile, trashCount }: FirstRunProps) {
	const { startBlank, trySample, creating } = useStartDocument();
	const inputRef = useRef<HTMLInputElement>(null);

	return (
		<section className="pt-5 transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0">
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
				title={<Trans>Your resumes and cover letters live here</Trans>}
				description={
					// Touch can't drop files, so it reads "Choose" there.
					<>
						<span className="pointer-coarse:hidden">
							<Trans>
								Import the resume you have and every section is laid out for you to refine, or start from a blank page.
								Drop a PDF, Word or JSON file anywhere here.
							</Trans>
						</span>
						<span className="hidden pointer-coarse:inline">
							<Trans>
								Import the resume you have and every section is laid out for you to refine, or start from a blank page.
								Choose a PDF, Word or JSON file.
							</Trans>
						</span>
					</>
				}
				action={
					<Button onClick={() => inputRef.current?.click()}>
						<Icon name="file-arrow-up" size={18} />
						<Trans>Choose a file</Trans>
					</Button>
				}
				secondary={
					<>
						{/* A peer of importing, not a footnote: many people start from nothing. */}
						<Button variant="secondary" disabled={creating} onClick={() => void startBlank()}>
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
			{trashCount > 0 && (
				<p className="mt-4 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
					<Plural value={trashCount} one="Trash has # document." other="Trash has # documents." />
					<Link to="/dashboard/trash" className="font-medium underline underline-offset-2">
						<Trans>Open Trash</Trans>
					</Link>
				</p>
			)}
		</section>
	);
}

/** Phones have no sidebar, so Trash is a row at the end of the library while it holds anything, as in the app. */
function TrashLink() {
	const { data: counts } = useQuery(orpc.documents.counts.queryOptions());
	const trashCount = counts?.trash ?? 0;
	if (!trashCount) return null;

	return (
		<Link
			to="/dashboard/trash"
			className="flex h-14 items-center gap-3 rounded-lg border border-line bg-surface px-3.5 transition-colors duration-quick ease-enter active:bg-press sm:hidden"
		>
			<Icon name="trash" size={22} className="text-ink-2" />
			<span className="grid flex-1">
				<span className="font-medium">
					<Trans>Trash</Trans>
				</span>
				<span className="text-xs text-ink-3">
					<Plural value={trashCount} one="# document" other="# documents" />
				</span>
			</span>
			<Icon name="caret-right" size={22} className="text-ink-3" />
		</Link>
	);
}

/** Resumes or Letters with none of that kind yet: the way to make the first one. */
function TypeEmpty({ type }: { type: "resume" | "letter" }) {
	const openDialog = useDialogStore((state) => state.openDialog);
	const { newLetter, creating } = useStartDocument();

	return type === "letter" ? (
		<EmptyState
			className="mt-5"
			title={<Trans>No cover letters yet</Trans>}
			description={<Trans>Write one for a job, or start from your latest resume.</Trans>}
			action={
				<Button disabled={creating} onClick={() => void newLetter()}>
					<Icon name="envelope-simple" />
					<Trans>New cover letter</Trans>
				</Button>
			}
		/>
	) : (
		<EmptyState
			className="mt-5"
			title={<Trans>No resumes yet</Trans>}
			description={<Trans>Import the one you have, or start blank.</Trans>}
			action={
				<Button onClick={() => openDialog("document.new", undefined)}>
					<Icon name="plus" />
					<Trans>New resume</Trans>
				</Button>
			}
		/>
	);
}

type DocumentsSelectionBarProps = {
	selection: DocumentSummary[];
	/** How many documents the page shows, for "Select all N". */
	total: number;
	onSelectAll: () => void;
	onClear: () => void;
	onTags: () => void;
};

/**
 * One bar acts on the selection (board D4): Tags, Sharing, Lock editing and Move to Trash. The accent stays on New
 * document: these are quiet, and Trash is red text because its toast can undo it.
 */
function DocumentsSelectionBar({ selection, total, onSelectAll, onClear, onTags }: DocumentsSelectionBarProps) {
	const resumes = selection.filter((document) => document.type === "resume").length;
	const allLocked = selection.every((document) => document.isLocked);
	const batch = useBatchActions();
	const [busy, setBusy] = useState(false);
	// Toasts sit bottom centre, where this bar is: lift them above it while it's on screen, so a result never hides it.
	useEffect(() => {
		const root = document.documentElement;
		const phone = window.matchMedia("(max-width: 639px)").matches;
		root.style.setProperty("--toast-bottom", phone ? "calc(8.25rem + env(safe-area-inset-bottom))" : "5.5rem");
		return () => {
			root.style.removeProperty("--toast-bottom");
		};
	}, []);
	const run = async (action: () => Promise<unknown>, { clear = false } = {}) => {
		setBusy(true);
		try {
			await action();
			if (clear) onClear();
		} finally {
			setBusy(false);
		}
	};

	return (
		<SelectionBar
			label={t`Selected documents`}
			count={selection.length}
			total={total}
			onSelectAll={onSelectAll}
			onClear={onClear}
		>
			<Button variant="ghost" size="sm" disabled={busy} onClick={onTags}>
				<Icon name="tag" />
				<Trans>Tags…</Trans>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							className="data-popup-open:bg-hover data-popup-open:text-ink"
						>
							<Icon name="globe-simple" />
							<Trans>Sharing</Trans>
							<Icon name="caret-down" />
						</Button>
					}
				/>
				<DropdownMenuContent side="top" align="start" alignOffset={-4} sideOffset={14} className="w-62">
					<DropdownMenuItem disabled={resumes === 0} onClick={() => void run(() => batch.setPublic(selection, true))}>
						<Icon name="globe-simple" />
						<Trans>Make public</Trans>
					</DropdownMenuItem>
					<DropdownMenuItem disabled={resumes === 0} onClick={() => void run(() => batch.setPublic(selection, false))}>
						<Icon name="eye-slash" />
						<Trans>Make private</Trans>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{/* Says what it reaches before it runs, instead of reporting skipped letters afterwards. */}
					<p className="px-2.5 pt-1.5 pb-2 t-small text-ink-3">
						{resumes === selection.length ? (
							<Plural
								value={resumes}
								one="Applies to the # resume selected."
								other="Applies to the # resumes selected."
							/>
						) : (
							<Plural
								value={resumes}
								_0="Letters have no public link."
								one="Applies to the # resume selected. Letters have no public link."
								other="Applies to the # resumes selected. Letters have no public link."
							/>
						)}
					</p>
				</DropdownMenuContent>
			</DropdownMenu>
			<Button
				variant="ghost"
				size="sm"
				disabled={busy}
				onClick={() => void run(() => batch.setLocked(selection, !allLocked))}
			>
				<Icon name={allLocked ? "lock-simple-open" : "lock-simple"} />
				{allLocked ? <Trans>Unlock editing</Trans> : <Trans>Lock editing</Trans>}
			</Button>
			<Button
				variant="danger-text"
				size="sm"
				disabled={busy}
				onClick={() => void run(() => batch.trash(selection), { clear: true })}
			>
				<Icon name="trash" />
				<Trans>Move to Trash</Trans>
			</Button>
		</SelectionBar>
	);
}

/** The library's shape while it loads: rows or cards at their final size. */
function LibrarySkeleton({ view }: { view: "grid" | "list" }) {
	if (view === "list") {
		return (
			<div className="mt-3 grid" aria-busy="true">
				<div className="h-8 border-b border-line max-sm:hidden" />
				{Array.from({ length: 5 }, (_, index) => (
					<div key={index} className="flex h-16 items-center gap-3.5 border-b border-line sm:h-[61px] sm:ps-[52px]">
						<Skeleton className="h-11 w-8 rounded-paper" />
						<Skeleton className="h-4 w-56 max-w-[60%]" />
					</div>
				))}
			</div>
		);
	}
	return (
		<div className={GRID_CLASS} aria-busy="true">
			{Array.from({ length: 4 }, (_, index) => (
				<div key={index} className="grid content-start gap-3 pb-8">
					<Skeleton className="aspect-page rounded-paper" />
					<Skeleton className="h-4 w-3/4" />
				</div>
			))}
		</div>
	);
}

/** A file dragged anywhere over the page shows the drop target, and dropping it opens import confirmation. */
export function DropToImport() {
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
					<Trans>PDF, Word or JSON. A resume is built from it.</Trans>
				</p>
			</div>
		</div>
	);
}
