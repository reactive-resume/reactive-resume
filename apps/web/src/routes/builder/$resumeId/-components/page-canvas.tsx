import type { EditorSelection } from "@/features/resume/editor/store";
import type { VersionSummary } from "@/features/resume/share/format";
import type { Template } from "@reactive-resume/schema/templates";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { templates } from "@/dialogs/resume/template/data";
import { useCurrentBuilderResumeSelector, useResumeData } from "@/features/resume/builder/draft";
import { CheckPageLayer, PageViewToggle } from "@/features/resume/editor/check/page-layer";
import { ParserView } from "@/features/resume/editor/check/parser-view";
import { CanvasStatusPill, usePageScale, ZoomBar } from "@/features/resume/editor/chrome";
import { measureOverflow, runFit } from "@/features/resume/editor/design/fit";
import { PageOverlay } from "@/features/resume/editor/page-overlay";
import { markProposals, pendingProposals } from "@/features/resume/editor/proposals/proposals";
import { useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { revealSelectionInPanel } from "@/features/resume/editor/write/reveal";
import { ResumePreview } from "@/features/resume/preview/preview";
import { formatVersionTime, getVersionTitle } from "@/features/resume/share/format";
import { orpc } from "@/libs/orpc/client";

const NONE: readonly never[] = [];

/**
 * The page canvas: the live resume on the sunken desk, with a caption above the first page, a pointer layer
 * that links lines to entries, and the zoom bar.
 */
export function PageCanvas() {
	const data = useResumeData();
	const format = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.format);
	const select = useEditorStore((state) => state.select);
	const setDrawerOpen = useEditorStore((state) => state.setDrawerOpen);
	const previewTemplate = useEditorStore((state) => state.previewTemplate);
	const historyVersionId = useEditorStore((state) => state.historyVersionId);
	const pageView = useEditorStore((state) => state.pageView);
	const checkTab = useEditorStore((state) => state.checkTab);
	const proposals = useEditorStore((state) => state.proposals);
	const assistantProposals = useEditorStore((state) => (state.assistantOpen ? state.assistantProposals : NONE));
	const sheetOpen = useEditorStore((state) => state.shareTab !== null);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const rendered = useEditorStore((state) => state.rendered);
	const setRendered = useEditorStore((state) => state.setRendered);
	const breakpoint = useBreakpoint();
	const [mode] = useEditorMode();
	const { canvasRef, fitScale, pageScale } = usePageScale(format);
	const isPhone = breakpoint === "mobile";

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
	const pendingOnPage = data ? pendingProposals(data, assistantProposals).length : 0;
	const parser = mode === "check" && pageView === "parser" && !viewing;

	// Design: a hovered or focused template is drawn on the page until it's applied or the pointer leaves.
	const previewData = viewing
		? viewing.data
		: data && previewTemplate
			? { ...data, metadata: { ...data.metadata, template: previewTemplate } }
			: data && marked.length > 0
				? markProposals(data, marked)
				: undefined;
	const overflow = data && !previewTemplate && !viewing ? measureOverflow(data, rendered) : null;
	// Desktop: the page moves 120px aside so it stays visible beside the Share & export sheet.
	const shifted = sheetOpen && (breakpoint === "desktop" || breakpoint === "wide");

	const onSelect = (selection: EditorSelection) => {
		select(selection);
		// Tablet: tapping a line opens the drawer on that entry.
		if (breakpoint === "tablet") setDrawerOpen(true);
		// Phones show the page and the panel one at a time; the selection bar opens the entry instead.
		if (mode === "write" && !isPhone) revealSelectionInPanel(selection);
	};

	return (
		<div className="relative h-full min-h-0 bg-sunken">
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
					if (breakpoint === "tablet") setDrawerOpen(false);
					if (isPhone) select(null);
				}}
				className={cn(
					"absolute inset-0 overflow-auto pb-24 outline-none",
					// Check keeps room above the page for the page-view toggle.
					mode === "check" && !viewing ? "pt-[68px]" : "pt-7",
					isPhone ? "px-4" : "px-10",
				)}
			>
				<ResumePreview
					data={previewData}
					pageLayout="vertical"
					pageGap={24}
					pageScale={pageScale}
					className={cn(
						"mx-auto w-fit transition-transform duration-emphasized ease-enter",
						shifted && "-translate-x-[120px] rtl:translate-x-[120px]",
						parser && "hidden",
					)}
					pageClassName={cn("rounded-none shadow-page", viewing && "outline-2 outline-offset-4 outline-ink")}
					onRender={setRendered}
					renderPageCaption={({ pageNumber }) => (
						<ResumePageCaption
							pageNumber={pageNumber}
							viewing={viewing}
							previewTemplate={previewTemplate}
							pendingOnPage={pendingOnPage}
							mode={mode}
							format={format}
							overflow={overflow}
						/>
					)}
					renderPageOverlay={({ pageIndex, pageMap }) =>
						// A version from History is read-only: its lines don't open entries.
						viewing ? null : mode === "check" ? (
							<CheckPageLayer pageIndex={pageIndex} pageMap={pageMap} />
						) : (
							<PageOverlay pageIndex={pageIndex} pageMap={pageMap} onSelect={onSelect} />
						)
					}
				/>
				{parser && <ParserView />}
			</section>

			{mode === "check" && !viewing && <PageViewToggle />}
			{!parser && <ZoomBar fitScale={fitScale} pageCount={Math.max(1, rendered.pageCount)} />}
		</div>
	);
}

type ResumePageCaptionProps = {
	pageNumber: number;
	viewing: { createdAt: Date; kind: VersionSummary["kind"]; name: VersionSummary["name"] } | null;
	previewTemplate: Template | null;
	pendingOnPage: number;
	mode: string;
	format: "a4" | "letter" | "free-form";
	overflow: ReturnType<typeof measureOverflow>;
};

/** Above the first page: the version or template being previewed, else the page label with proposals and overflow. */
function ResumePageCaption(props: ResumePageCaptionProps) {
	const { pageNumber, viewing, previewTemplate, pendingOnPage, mode, format, overflow } = props;
	const { i18n } = useLingui();
	const formatLabel = { a4: "A4", letter: t`Letter`, "free-form": t`Free-form` }[format];

	if (pageNumber === 1) {
		return (
			<figcaption className="mb-2.5 flex flex-wrap items-center justify-center gap-2.5 text-center text-xs font-medium text-ink-3">
				{viewing ? (
					<CanvasStatusPill icon="history">
						<Trans>
							Viewing {formatVersionTime(viewing.createdAt, i18n.locale)} · {getVersionTitle(viewing)} · read-only
						</Trans>
					</CanvasStatusPill>
				) : previewTemplate ? (
					<CanvasStatusPill icon="visibility">
						<Trans>Previewing {templates[previewTemplate].name} · click to apply</Trans>
					</CanvasStatusPill>
				) : (
					<>
						{pendingOnPage > 0 ? (
							<span className="text-accent-text">
								<Plural
									value={pendingOnPage}
									one="# proposed edit on this page · nothing changes until you accept"
									other="# proposed edits on this page · nothing changes until you accept"
								/>
							</span>
						) : mode === "check" ? (
							<Trans>Page 1 · {formatLabel}</Trans>
						) : (
							<Trans>Page 1</Trans>
						)}
						{overflow && <OverflowChip {...overflow} />}
					</>
				)}
			</figcaption>
		);
	}

	// Content past the authored pages: a dashed warn line at the page boundary.
	if (overflow && pageNumber > overflow.authored) {
		return (
			<figcaption className="relative mb-2.5 border-t-[1.5px] border-dashed border-warn">
				<span className="absolute end-0 -top-2.5 rounded bg-sunken px-1.5 text-[11px] font-semibold text-warn-text">
					<Trans>Page {pageNumber}</Trans>
				</span>
			</figcaption>
		);
	}

	return (
		<figcaption className="mb-2.5 text-center text-xs font-medium text-ink-3">
			<Trans>Page {pageNumber}</Trans>
		</figcaption>
	);
}

type OverflowChipProps = { authored: number; lines: number | null };

/** "Runs onto page 2 by about 6 lines" with Fit, which tightens the design until it fits (one undo step). */
function OverflowChip({ authored, lines }: OverflowChipProps) {
	const [fitting, setFitting] = useState(false);
	const next = authored + 1;

	return (
		<span className="flex min-h-8 items-center gap-2 rounded-lg bg-warn-soft py-1 ps-3 pe-1.5 text-[13px] text-warn-text">
			<Icon name="vertical_split" size={18} />
			{lines ? (
				<Plural
					value={lines}
					one={`Runs onto page ${next} by about # line`}
					other={`Runs onto page ${next} by about # lines`}
				/>
			) : (
				<Trans>Runs onto page {next}</Trans>
			)}
			<button
				type="button"
				disabled={fitting}
				onClick={() => {
					setFitting(true);
					void runFit().finally(() => setFitting(false));
				}}
				className="h-6 rounded-md bg-surface px-2.5 text-xs font-semibold whitespace-nowrap text-ink shadow-e1 disabled:opacity-60"
			>
				{authored === 1 ? <Trans>Fit to one page</Trans> : <Trans>Fit to {authored} pages</Trans>}
			</button>
		</span>
	);
}
