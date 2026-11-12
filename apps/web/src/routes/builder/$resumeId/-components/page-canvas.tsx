import type { EditorSelection } from "@/features/resume/editor/store";
import type { VersionSummary } from "@/features/resume/share/format";
import type { Template } from "@reactive-resume/schema/templates";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, lazyRouteComponent } from "@tanstack/react-router";
import { Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import { filterSections } from "@reactive-resume/pdf/filtering";
import { measureOverflow } from "@reactive-resume/pdf/page-map";
import { spillingSections } from "@reactive-resume/resume/spill";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { templates } from "@/dialogs/resume/template/data";
import { useCurrentBuilderResumeSelector, useResumeData, useResumeStore } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { CheckPageLayer, PageViewToggle } from "@/features/resume/editor/check/page-layer";
import { ParserView } from "@/features/resume/editor/check/parser-view";
import { usePageScale, ZoomBar } from "@/features/resume/editor/chrome";
import { addSpillPage, runFit } from "@/features/resume/editor/design/fit";
import { PageOverlay } from "@/features/resume/editor/page-overlay";
import { markProposals, pendingProposals } from "@/features/resume/editor/proposals/proposals";
import { useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { revealSelectionInPanel } from "@/features/resume/editor/write/reveal";
import { ResumePreview } from "@/features/resume/preview/preview";
import { ResumeVersionBar } from "@/features/resume/share/history-tab";
import { orpc } from "@/libs/orpc/client";

const NONE: readonly never[] = [];

const WebPagePreview = lazyRouteComponent(() => import("@/features/resume/share/web-page-preview"), "WebPagePreview");

/** Share shows the web page; every other mode, the PDF's pages. */

/** The Download & history sheet's width on desktop (the Sheet's `sm:max-w-[440px]`). */
const SHEET_WIDTH = 440;
/** Side by side: the space between pages, the Add page column, a page's height in points and its label's height. */
const PAGE_GAP = 40;
const ADD_PAGE_WIDTH = 140;
const PAGE_HEIGHT = { a4: 841.89, letter: 792, "free-form": 841.89 } as const;
const CAPTION_HEIGHT = 26;
export function PageCanvas() {
	const [mode] = useEditorMode();
	if (mode !== "share") return <ResumePageCanvas />;
	return (
		<Suspense>
			<WebPagePreview />
		</Suspense>
	);
}

/**
 * The page canvas: the live resume on the sunken desk, with a caption above the first page, a pointer layer
 * that links lines to entries, and the zoom bar.
 */
function ResumePageCanvas() {
	const data = useResumeData();
	const format = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.format);
	const previewTemplate = useEditorStore((state) => state.previewTemplate);
	const [compareId, setCompareId] = useState<string | null>(null);
	const historyVersionId = useEditorStore((state) => state.historyVersionId);
	const pageView = useEditorStore((state) => state.pageView);
	const checkTab = useEditorStore((state) => state.checkTab);
	const proposals = useEditorStore((state) => state.proposals);
	const assistantProposals = useEditorStore((state) => (state.assistantOpen ? state.assistantProposals : NONE));
	const sheetOpen = useEditorStore((state) => state.sheetTab !== null);
	const panelHidden = useEditorStore((state) => state.panelHidden);
	const locked = useCurrentBuilderResumeSelector((resume) => resume.isLocked);
	const layoutPages = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.layout.pages.length);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const rendered = useEditorStore((state) => state.rendered);
	const setRendered = useEditorStore((state) => state.setRendered);
	const breakpoint = useBreakpoint();
	const [mode] = useEditorMode();
	// Desktop: the Download & history sheet covers the canvas's end; the page fits, and centres in, what's left.
	const desktop = breakpoint === "desktop" || breakpoint === "wide";
	const shifted = sheetOpen && desktop;
	const isPhone = breakpoint === "mobile";
	// With the panel hidden, the pages sit side by side when there are several, each whole, with a place to add one.
	const sideBySide = panelHidden && desktop && rendered.pageCount > 1 && mode !== "check";
	const { canvasRef, fitScale, pageScale } = usePageScale(
		format,
		shifted ? SHEET_WIDTH : sideBySide ? ADD_PAGE_WIDTH + PAGE_GAP : 0,
		sideBySide
			? { pages: rendered.pageCount, gap: PAGE_GAP, pageHeight: PAGE_HEIGHT[format], chrome: CAPTION_HEIGHT }
			: undefined,
	);

	// History: the picked version is drawn on the page, read-only, until the user restores it or goes back to now.
	const { data: version } = useQuery({
		...orpc.resume.getVersion.queryOptions({ input: { resumeId, versionId: historyVersionId ?? "" } }),
		enabled: historyVersionId !== null,
	});
	const viewing = historyVersionId !== null && version?.id === historyVersionId ? version : null;

	// Check → Writing's and the assistant's proposed edits show on the page, the old text struck through and the new
	// highlighted.
	const markEdits = mode === "check" && checkTab === "writing" && pageView === "page" && proposals.length > 0;
	const marked = [...(markEdits ? proposals : []), ...assistantProposals];
	const applications = useResumeStore((state) => state.proposalApplications);
	const pendingOnPage = data ? pendingProposals(data, assistantProposals, undefined, applications).length : 0;
	const parser = mode === "check" && pageView === "parser" && !viewing;

	// Design: a hovered or focused template is drawn on the page until it's applied or the pointer leaves.
	const previewData = viewing
		? compareId === historyVersionId
			? data
			: viewing.data
		: data && previewTemplate
			? { ...data, metadata: { ...data.metadata, template: previewTemplate } }
			: // Only undecided edits change the page: once every one is decided, it draws (and measures) as it is.
				data && pendingProposals(data, marked, undefined, applications).length > 0
				? markProposals(data, marked, applications)
				: undefined;
	// Fit is the resume's as it is: a render with edits marked (old and new text both shown) doesn't count. The callback
	// keeps one identity (the preview re-reports on every new one), reading whether this render is marked from a ref.
	const fitRendered = useEditorStore((state) => state.fitRendered);
	const markedRender = useRef(false);
	const marking = previewData !== undefined;
	// A layout effect, so it's current before the preview's own effect reports the render.
	useLayoutEffect(() => {
		markedRender.current = marking;
	}, [marking]);
	const onRender = useCallback(
		(render: Parameters<typeof setRendered>[0]) => setRendered(render, markedRender.current),
		[setRendered],
	);
	const overflow = data && !previewTemplate && !viewing ? measureOverflow(data, fitRendered) : null;

	const onSelect = (selection: EditorSelection) => {
		useEditorStore.setState({ selection });
		// Tablet: tapping a line opens the drawer on that entry.
		if (breakpoint === "tablet") useEditorStore.setState({ panelHidden: false });
		// Phones show the page and the panel one at a time; the selection bar opens the entry instead.
		if (mode === "write" && !isPhone) revealSelectionInPanel(selection);
	};

	return (
		<div data-design="canvas" className="@container relative h-full min-h-0 bg-sunken dark:bg-raised">
			<section
				ref={canvasRef}
				// The scroll area takes focus so the page can be scrolled from the keyboard even before its lines load.
				// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be reachable by keyboard.
				tabIndex={0}
				aria-label={t`Resume page`}
				// Tapping the page (not a line) closes the tablet drawer but keeps the selection; on phones it
				// dismisses the selection bar.
				onPointerDown={(event) => {
					if ((event.target as HTMLElement).closest("[data-kind]")) return;
					if (breakpoint === "tablet") useEditorStore.setState({ panelHidden: true });
					if (isPhone) useEditorStore.setState({ selection: null });
				}}
				className={cn(
					// The region takes focus to scroll from the keyboard: it shows the ring, inset since it fills its container.
					"absolute inset-0 overflow-auto pb-24 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
					// Check keeps room above the page for the page-view toggle.
					viewing ? "pt-[88px]" : mode === "check" ? "pt-[68px]" : "pt-3.5",
					isPhone ? "px-4" : "px-10",
				)}
			>
				<div className={cn("mx-auto flex w-fit items-start", parser && "hidden")} style={{ gap: PAGE_GAP }}>
					<ResumePreview
						data={previewData}
						pageLayout={sideBySide ? "horizontal" : "vertical"}
						pageGap={sideBySide ? PAGE_GAP : 24}
						pageScale={pageScale}
						className={cn(
							"w-fit transition-transform duration-emphasized ease-enter",
							shifted && "-translate-x-[220px] rtl:translate-x-[220px]",
						)}
						pageClassName={cn("rounded-paper bg-paper shadow-page")}
						onRender={onRender}
						renderPageCaption={({ pageNumber }) =>
							viewing ? null : (
								<ResumePageCaption
									pageNumber={pageNumber}
									pageCount={Math.max(1, rendered.pageCount)}
									viewing={viewing}
									previewTemplate={previewTemplate}
									pendingOnPage={pendingOnPage}
									format={format}
									overflow={overflow}
									locked={locked}
									sideBySide={sideBySide}
									// A page's own menu, where the pages on screen are the pages of the layout (nothing spills).
									menu={
										sideBySide &&
										pageNumber > 1 &&
										!locked &&
										!viewing &&
										!overflow &&
										layoutPages === rendered.pageCount ? (
											<PageMenu pageIndex={pageNumber - 1} />
										) : null
									}
								/>
							)
						}
						renderPageOverlay={({ pageIndex, pageMap, document, pageScale }) =>
							// A version from History is read-only: its lines don't open entries.
							viewing ? null : mode === "check" ? (
								<CheckPageLayer pageIndex={pageIndex} pageMap={pageMap} document={document} pageScale={pageScale} />
							) : (
								<PageOverlay pageIndex={pageIndex} pageMap={pageMap} onSelect={onSelect} />
							)
						}
					/>
					{sideBySide && !locked && !viewing && <AddPage height={PAGE_HEIGHT[format] * pageScale} />}
				</div>
				{parser && <ParserView />}
			</section>

			{viewing && (
				<ResumeVersionBar
					showingNow={compareId === historyVersionId}
					onCompare={(now) => setCompareId(now ? historyVersionId : null)}
				/>
			)}

			{(breakpoint === "tablet" || (desktop && panelHidden)) && !viewing && (
				<Button
					variant="secondary"
					size="sm"
					aria-expanded={!panelHidden}
					aria-controls="editor-panel"
					className="absolute start-4 top-3"
					onClick={() => useEditorStore.setState({ panelHidden: !panelHidden })}
				>
					<Icon name="sidebar-simple" />
					{panelHidden ? <Trans>Show panel</Trans> : <Trans>Hide panel</Trans>}
				</Button>
			)}

			{mode === "check" && !viewing && <PageViewToggle />}
			{!parser && <ZoomBar fitScale={fitScale} />}
		</div>
	);
}

type ResumePageCaptionProps = {
	pageNumber: number;
	pageCount: number;
	viewing: { createdAt: Date; kind: VersionSummary["kind"]; name: VersionSummary["name"] } | null;
	previewTemplate: Template | null;
	pendingOnPage: number;
	format: "a4" | "letter" | "free-form";
	overflow: ReturnType<typeof measureOverflow>;
	locked: boolean;
	sideBySide: boolean;
	menu: ReactNode;
};

/**
 * Above each page, its label as the app prints it: "Page 1 of 2 · A4" (side by side, "Page 1 · A4" with the page's
 * menu). Above the first page also what stands in for the live document (a version, a template) and what overflows.
 */
function ResumePageCaption(props: ResumePageCaptionProps) {
	const { pageNumber, pageCount, viewing, previewTemplate, pendingOnPage, format, overflow, locked, sideBySide, menu } =
		props;
	const { i18n } = useLingui();
	const formatLabel = {
		a4: "A4",
		letter: t({ message: "Letter", context: "US Letter paper size (8.5 × 11 in), shown beside A4" }),
		"free-form": t`Free-form`,
	}[format];
	const page = i18n.number(pageNumber);
	const pages = i18n.number(pageCount);
	// The label spans the canvas (the container), so it stays centred over the page whatever the page's width.
	const label = cn(
		"mx-auto flex h-4 w-fit items-center justify-center gap-1.5 t-mono whitespace-nowrap text-ink-3",
		!sideBySide && "absolute start-1/2 top-0 w-[100cqw] -translate-x-1/2 rtl:translate-x-1/2",
	);

	// A continuation of an authored page that runs over: marked where it starts.
	const spill = pageNumber > 1 && overflow?.spills.some((spill) => spill.pages.includes(pageNumber));

	return (
		<figcaption className={cn("relative mb-2.5 min-h-4", spill && "border-t-[1.5px] border-dashed border-warn")}>
			{viewing ? null : previewTemplate ? (
				<div className={label}>
					<Trans>
						Preview · {templates[previewTemplate].name} · Page {page} of {pages} · {formatLabel}
					</Trans>
				</div>
			) : (
				<>
					{sideBySide ? (
						<div className={label}>
							<Trans>
								Page {page} · {formatLabel}
							</Trans>
							{menu}
						</div>
					) : locked ? (
						<div className={label}>
							<Trans>
								Page {page} of {pages} · {formatLabel} · read-only
							</Trans>
						</div>
					) : (
						<div className={label}>
							<Trans>
								Page {page} of {pages} · {formatLabel}
							</Trans>
						</div>
					)}
					{pageNumber === 1 && (pendingOnPage > 0 || overflow) && (
						<div
							className={cn(
								"flex flex-wrap items-center justify-center gap-2.5 text-center text-xs font-medium",
								// Under the label, which is laid over the caption when the pages are stacked.
								sideBySide ? "mt-2" : "pt-6",
							)}
						>
							{pendingOnPage > 0 && (
								<span className="text-accent-text">
									<Plural
										value={pendingOnPage}
										one="# proposed edit on this page · nothing changes until you accept"
										other="# proposed edits on this page · nothing changes until you accept"
									/>
								</span>
							)}
							{overflow && <OverflowChip {...overflow} />}
						</div>
					)}
				</>
			)}
		</figcaption>
	);
}

/** Add page is a place beside the last page, not a button in a panel. An empty page waits for sections. */
function AddPage({ height }: { height: number }) {
	const updateResumeData = useResumeStore((state) => state.updateResumeData);

	return (
		<button
			type="button"
			style={{ height, width: ADD_PAGE_WIDTH }}
			className="mt-[26px] flex shrink-0 flex-col items-center justify-center gap-2 rounded-md text-center text-sm/5 font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-2 transition-colors duration-quick outline-dashed hover:bg-hover hover:text-ink"
			onClick={() =>
				updateResumeData(
					(draft) => {
						draft.metadata.layout.pages.push({ fullWidth: false, main: [], sidebar: [] });
					},
					{ newStep: true },
				)
			}
		>
			<Icon name="plus" size={20} />
			<Trans>Add page</Trans>
			<span className="max-w-[104px] text-xs/4 font-normal text-ink-3">
				<Trans>Sections move here from Layout, or by “Move to”</Trans>
			</span>
		</button>
	);
}

/** A page's own menu: full width, arrange its sections (Design), and Delete page, which says where its sections go. */
function PageMenu({ pageIndex }: { pageIndex: number }) {
	const navigate = useNavigate({ from: "/builder/$resumeId" });
	const data = useResumeData();
	const page = data?.metadata.layout.pages[pageIndex] ?? null;
	const pageCount = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.layout.pages.length);
	const updateResumeData = useResumeStore((state) => state.updateResumeData);
	if (!page || !data) return null;
	const number = i18n.number(pageIndex + 1);
	const sections = filterSections([...page.main, ...page.sidebar], data).length;
	// Its sections go to the first page that stays.
	const target = i18n.number(pageIndex === 0 ? 2 : 1);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<IconButton
						icon="dots-three"
						label={t`Page ${number} options`}
						size="icon-sm"
						className="-my-1.5 ms-0.5 -me-1.5 size-6 aria-expanded:bg-accent-soft aria-expanded:text-accent-text"
					/>
				}
			/>
			<DropdownMenuContent align="start" aria-label={t`Page ${number}`} className="w-[250px]">
				<DropdownMenuCheckboxItem
					className="ps-9 pe-2.5 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:start-2.5 [&>[data-slot=dropdown-menu-checkbox-item-indicator]]:end-auto"
					checked={page.fullWidth}
					onCheckedChange={(checked) =>
						updateResumeData(
							(draft) => {
								const target = draft.metadata.layout.pages[pageIndex];
								if (!target) return;
								target.fullWidth = checked;
								// A full-width page has no sidebar: its sections join the main column.
								if (checked) {
									target.main.push(...target.sidebar);
									target.sidebar = [];
								}
							},
							{ newStep: true },
						)
					}
				>
					<span>
						<Trans>Full width, no sidebar</Trans>
					</span>
				</DropdownMenuCheckboxItem>
				<DropdownMenuItem
					onClick={() => {
						useEditorStore.setState({ panelHidden: false });
						void navigate({
							to: ".",
							search: (previous: Record<string, unknown>) => ({
								...previous,
								mode: "design",
								designCategory: "layout",
							}),
						});
					}}
				>
					<Icon name="columns" />
					<span>
						<Trans>Arrange its sections…</Trans>
					</span>
				</DropdownMenuItem>
				{pageCount > 1 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							onClick={() => {
								updateResumeData(
									(draft) => {
										const pages = draft.metadata.layout.pages;
										const removed = pages[pageIndex];
										const kept = pages[pageIndex === 0 ? 1 : 0];
										if (!removed || !kept) return;
										kept.main.push(...removed.main, ...(kept.fullWidth ? removed.sidebar : []));
										if (!kept.fullWidth) kept.sidebar.push(...removed.sidebar);
										pages.splice(pageIndex, 1);
									},
									{ newStep: true },
								);
								undoToast(t`Page ${number} deleted`);
							}}
						>
							<Icon name="trash" />
							<span>
								<Trans>Delete page</Trans>
							</span>
						</DropdownMenuItem>
						<p className="px-2.5 ps-[38px] pt-0.5 pb-2 text-xs/4 text-ink-3">
							<Plural
								value={sections}
								_0="It has no sections. Undo puts the page back."
								one={`Its # section moves to page ${target}. Undo puts the page back.`}
								other={`Its # sections move to page ${target}. Undo puts the page back.`}
							/>
						</p>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

type OverflowChipProps = NonNullable<ReturnType<typeof measureOverflow>>;

/**
 * Names the first authored page that spills, with two ways out: Add page, which moves the sections that spill off
 * the last page onto a new one, and Fit, which tightens the design until it fits. Each is one undo step.
 */
function OverflowChip({ authored, spills, pageCount }: OverflowChipProps) {
	const [fitting, setFitting] = useState(false);
	const first = spills[0];
	const lines = first?.lines;
	const next = authored + 1;
	const data = useResumeData();
	const pageMap = useEditorStore((state) => state.rendered.pageMap);
	const canAddPage = !!data && spillingSections(data.metadata.layout.pages, pageMap?.nodes) !== null;
	const action =
		"h-6 rounded-md bg-surface px-2.5 text-xs font-semibold whitespace-nowrap text-ink shadow-e1 disabled:opacity-60";

	return (
		<span className="flex min-h-8 items-center gap-2 rounded-lg bg-warn-soft py-1 ps-3 pe-1.5 text-[13px] text-warn-text">
			<Icon name="square-split-horizontal" size={18} />
			{first && first.pages.length === 1 && lines ? (
				<Plural
					value={lines}
					one={`Page ${ph({ page: i18n.number(first.authoredPage) })} runs over by about # line`}
					other={`Page ${ph({ page: i18n.number(first.authoredPage) })} runs over by about # lines`}
				/>
			) : (
				<Plural value={pageCount} one="Runs to # page" other="Runs to # pages" />
			)}
			{canAddPage && (
				<button type="button" disabled={fitting} onClick={() => addSpillPage()} className={action}>
					<Trans>Add page {next}</Trans>
				</button>
			)}
			<button
				type="button"
				disabled={fitting}
				onClick={() => {
					setFitting(true);
					void runFit().finally(() => setFitting(false));
				}}
				className={action}
			>
				<Plural value={authored} _1="Fit to one page" other="Fit to # pages" />
			</button>
		</span>
	);
}
