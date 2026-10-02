import type { DocumentSort, DocumentSummary, DocumentTypeFilter } from "./filter";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { cn } from "@reactive-resume/utils/style";
import { LinkApplicationDialog, TagsDialog } from "./document-actions";
import { DocumentCard, DocumentRow } from "./document-card";
import { collectTags, filterDocuments } from "./filter";
import { LibraryError } from "./library-error";
import { useStartDocument } from "./new-document-dialog";
import { useDialogStore } from "@/dialogs/store";
import { isEditableElementFocused } from "@/features/resume/builder/draft";
import { orpc } from "@/libs/orpc/client";

export type DocumentsSearch = {
	type: DocumentTypeFilter;
	q: string;
	tags: string[];
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
	const [tagsFor, setTagsFor] = useState<DocumentSummary | null>(null);
	const [linkFor, setLinkFor] = useState<DocumentSummary | null>(null);
	// Grid and list animate in only after a switch, never on the page's first render.
	const [viewSwitched, setViewSwitched] = useState(false);
	const {
		data: documents,
		isPending,
		isError,
		isFetching,
		refetch,
	} = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
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

	const all = documents ?? [];
	const shown = filterDocuments(all, search);
	const tags = collectTags(all);
	const counts = {
		all: all.length,
		resume: all.filter((document) => document.type === "resume").length,
		letter: all.filter((document) => document.type === "letter").length,
	};
	const filtered = search.type !== "all" || search.q.trim() !== "" || search.tags.length > 0;
	const itemProps = {
		onTags: setTagsFor,
		onLink: setLinkFor,
	};

	return (
		<div className="mx-auto grid w-full max-w-[1180px] content-start gap-5 px-8 py-8 max-sm:px-4 max-sm:py-5">
			<h1 className="font-display text-[30px] leading-9 font-medium">
				<Trans>Documents</Trans>
			</h1>

			{isError && <LibraryError retrying={isFetching} onRetry={() => void refetch()} />}

			{isError && !documents ? null : !isPending && all.length === 0 ? (
				<FirstRun onChooseFile={() => openDialog("document.new", undefined)} />
			) : (
				<>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
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
									<Icon name="search" size={18} />
								</InputGroupAddon>
								<InputGroupInput
									ref={searchRef}
									type="search"
									value={search.q}
									aria-label={t`Search documents`}
									placeholder={t`Search`}
									onChange={(event) => onSearchChange({ q: event.target.value })}
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
									<Icon name="grid_view" size={18} />
								</SegmentedControlItem>
								<SegmentedControlItem value="list" aria-label={t`List`}>
									<Icon name="view_list" size={18} />
								</SegmentedControlItem>
							</SegmentedControl>
						</div>
					</div>

					{tags.length > 0 && (
						<TagFilter tags={tags} active={search.tags} onChange={(next) => onSearchChange({ tags: next })} />
					)}

					{isPending ? (
						<LibrarySkeleton view={view} />
					) : shown.length === 0 ? (
						<div className="grid justify-items-center gap-2 py-16 text-center">
							<Icon name="search_off" size={28} className="text-ink-3" />
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
									onClick={() => onSearchChange({ q: "", tags: [], type: "all" })}
								>
									<Trans>Clear search and filters</Trans>
								</Button>
							)}
						</div>
					) : view === "list" ? (
						<table className={cn("w-full table-fixed border-collapse", viewEnter)}>
							<caption className="sr-only">
								<Trans>Documents</Trans>
							</caption>
							<thead>
								<tr className="border-b border-line text-start text-xs font-medium text-ink-3">
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
										key={`${document.type}:${document.id}`}
										document={document}
										introIndex={intro ? index : undefined}
										{...itemProps}
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
									key={`${document.type}:${document.id}`}
									document={document}
									introIndex={intro ? index : undefined}
									{...itemProps}
								/>
							))}
						</div>
					)}
				</>
			)}

			<DropToImport />
			<TagsDialog document={tagsFor} onClose={() => setTagsFor(null)} />
			<LinkApplicationDialog document={linkFor} onClose={() => setLinkFor(null)} />
		</div>
	);
}

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

/** The first visit: import is the filled button here, and only here. */
function FirstRun({ onChooseFile }: { onChooseFile: () => void }) {
	const { startBlank, trySample, creating } = useStartDocument();

	return (
		<section className="grid max-w-xl gap-4 pt-4 transition-[opacity,translate] duration-emphasized ease-enter starting:translate-y-2 starting:opacity-0">
			<h2 className="font-display text-[26px] leading-8 font-medium">
				<Trans>Let's start with what you have</Trans>
			</h2>
			<p className="leading-6 text-ink-2">
				<Trans>
					Import your current resume and we'll lay out every section for you to refine. Or start fresh. Start with your
					name. Build from there.
				</Trans>
			</p>
			<div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line-2 p-5">
				<Icon name="upload_file" size={24} className="text-ink-2" />
				<span className="flex-1 text-sm text-ink-2">
					<Trans>Drop a PDF, Word or JSON file</Trans>
				</span>
				<Button onClick={onChooseFile}>
					<Trans>Choose a file</Trans>
				</Button>
			</div>
			<div className="flex flex-wrap gap-4 text-sm">
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
			</div>
		</section>
	);
}

type TagFilterProps = { tags: string[]; active: string[]; onChange: (tags: string[]) => void };

function TagFilter({ tags, active, onChange }: TagFilterProps) {
	return (
		<fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
			<legend className="sr-only">
				<Trans>Filter by tag</Trans>
			</legend>
			{tags.map((tag) => {
				const isActive = active.includes(tag);
				return (
					<button
						key={tag}
						type="button"
						aria-pressed={isActive}
						onClick={() => onChange(isActive ? active.filter((known) => known !== tag) : [...active, tag])}
						className={cn(
							"min-h-7 rounded-full border px-3 text-[13px] transition-[background-color,border-color,color,scale] duration-quick ease-enter active:scale-[0.97] pointer-coarse:min-h-11",
							isActive ? "border-accent bg-accent-soft text-accent-text" : "border-line-2 text-ink-2 hover:bg-hover",
						)}
					>
						#{tag}
					</button>
				);
			})}
		</fieldset>
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
					<Skeleton className="aspect-page rounded-[6px]" />
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
				<Icon name="download" size={32} className="text-accent-text" />
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
