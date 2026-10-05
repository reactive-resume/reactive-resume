import type { ResolvedResumePreviewProps } from "./preview.shared";
import type { PreviewPageSize } from "./preview.shared.utils";
import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { Template } from "@reactive-resume/schema/templates";
import type { MotionStyle } from "motion/react";
import { t } from "@lingui/core/macro";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { isRTL } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { isEditableElementFocused, usePreviewPausedStore, useResumeData } from "../builder/draft";
import { PdfCanvasDocument, PdfCanvasPage } from "./pdf-canvas";
import { ResumePreviewLoader } from "./preview.shared";
import { getResumePreviewGapValue, getResumePreviewPageCount } from "./preview.shared.utils";
import { ResumeAccessibleText } from "./resume-accessible-text";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";
import { getReadableErrorMessage } from "@/libs/error-message";
import { EASE } from "@/libs/motion";

type PreviewPdf = {
	file: Blob;
	id: number;
	pageMap: PageMap | undefined;
	numPages: number;
	pageSizes: Record<number, PreviewPageSize>;
	phase: "active" | "exiting" | "staged";
	renderedPages: number[];
	template: Template;
};

const UPDATE_DEBOUNCE_MS = 100;
// While a field has focus the page waits for a pause in typing, so rendering (about 230 ms for two pages,
// on the main thread) doesn't compete with keystrokes.
const TYPING_DEBOUNCE_MS = 250;
// Incoming layer fades in over the old one; the old layer holds at full opacity until the incoming one is opaque,
// then drops out. Fading both at once dips the page towards the background mid-swap.
const INCOMING_TRANSITION = { duration: 0.15, ease: EASE };
const EXITING_TRANSITION = { duration: 0.1, delay: 0.18 };
// Motion animates in JS, so the CSS reduced-motion rule doesn't reach it: with reduced motion a new render replaces
// the old one at once, and no half-faded page is ever on screen.
const INSTANT_TRANSITION = { duration: 0 };

const createPreviewPdf = (file: Blob, id: number, template: Template, pageMap: PageMap | undefined): PreviewPdf => ({
	file,
	id,
	pageMap,
	numPages: 0,
	pageSizes: {},
	// Every render, the first one included, paints hidden and fades in once all its pages are drawn.
	phase: "staged",
	renderedPages: [],
	template,
});

const addPreviewLayer = (layers: PreviewPdf[], nextPdf: PreviewPdf) => {
	const activeLayers = layers.filter((layer) => layer.phase === "active");
	return activeLayers.length === 0 ? [nextPdf] : [...activeLayers, nextPdf];
};

const getActivePreviewLayer = (layers: PreviewPdf[]) => layers.find((layer) => layer.phase === "active") ?? null;

const setPreviewPageCount = (layers: PreviewPdf[], layerId: number, numPages: number) =>
	layers.map((layer) => (layer.id === layerId ? { ...layer, numPages } : layer));

const setPreviewPageSize = (layers: PreviewPdf[], layerId: number, pageNumber: number, pageSize: PreviewPageSize) =>
	layers.map((layer) =>
		layer.id === layerId
			? {
					...layer,
					pageSizes: {
						...layer.pageSizes,
						[pageNumber]: pageSize,
					},
				}
			: layer,
	);

const markPreviewPageRendered = (layers: PreviewPdf[], layerId: number, pageNumber: number) => {
	let shouldPromoteLayer = false;

	const nextLayers = layers.map((layer) => {
		if (layer.id !== layerId || layer.renderedPages.includes(pageNumber)) return layer;

		const renderedPages = [...layer.renderedPages, pageNumber];
		const nextLayer = { ...layer, renderedPages };

		if (layer.phase === "staged" && renderedPages.length >= layer.numPages) {
			shouldPromoteLayer = true;
			return { ...nextLayer, phase: "active" as const };
		}

		return nextLayer;
	});

	if (!shouldPromoteLayer) return nextLayers;

	return nextLayers.map((layer) => {
		if (layer.id === layerId) return layer;
		if (layer.phase === "active") return { ...layer, phase: "exiting" as const };

		return layer;
	});
};

const removePreviewLayer = (layers: PreviewPdf[], layerId: number) => layers.filter((layer) => layer.id !== layerId);

export function ResumePreviewClient({
	className,
	data,
	pageGap = 16,
	pageLayout,
	pageScale,
	pageClassName,
	showPageNumbers,
	renderPageCaption,
	renderPageOverlay,
	onRender,
	includeCoverLetterHeader = false,
}: ResolvedResumePreviewProps) {
	const builderResumeData = useResumeData();
	const resumeData = data ?? builderResumeData;
	const paused = usePreviewPausedStore((state) => state.paused);
	const reducedMotion = useReducedMotion();

	const [previewLayers, setPreviewLayers] = useState<PreviewPdf[]>([]);

	const pdfIdRef = useRef(0);
	const requestIdRef = useRef(0);
	const hasPreviewRef = useRef(false);

	useEffect(() => {
		if (!resumeData) return;
		// Mobile hides the preview behind the Edit/Design overlay; skip re-rendering and keep the last PDF shown.
		if (paused) return;

		let cancelled = false;
		const requestId = ++requestIdRef.current;
		const delay = !hasPreviewRef.current ? 0 : isEditableElementFocused() ? TYPING_DEBOUNCE_MS : UPDATE_DEBOUNCE_MS;

		const stale = () => cancelled || requestId !== requestIdRef.current;
		const renderOptions = includeCoverLetterHeader ? { includeCoverLetterHeader } : undefined;

		const generatePdfPreview = async () => {
			try {
				if (stale()) return;
				let pageMap: PageMap | undefined;
				const blob = await createResumePdfBlob(resumeData, undefined, renderOptions, {
					onPageMap: (map) => {
						pageMap = map;
					},
				});

				if (!stale()) {
					const nextPdf = createPreviewPdf(blob, pdfIdRef.current++, resumeData.metadata.template, pageMap);

					hasPreviewRef.current = true;
					setPreviewLayers((current) => addPreviewLayer(current, nextPdf));
				}
			} catch (error) {
				if (stale()) return;
				const fallback = t`The resume preview could not be updated. The last valid preview is still shown.`;
				toast.add({
					type: "error",
					// Name the cause the user can fix (an unsupported character, a font that didn't load); keep other engine errors generic.
					description:
						error instanceof Error && error.cause === "pdf-text-loss"
							? getReadableErrorMessage(error, fallback)
							: fallback,
					id: "resume-preview-render-error",
				});
			}
		};

		const timeoutId = window.setTimeout(() => {
			void generatePdfPreview();
		}, delay);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [paused, resumeData, includeCoverLetterHeader]);

	const activeLayer = getActivePreviewLayer(previewLayers);
	const activePageCount = activeLayer?.numPages ?? 0;
	const activePageMap = activeLayer?.pageMap;
	const activeFile = activeLayer?.file;
	useEffect(() => {
		if (activePageCount > 0 && activeFile)
			onRender?.({ pageCount: activePageCount, pageMap: activePageMap, file: activeFile });
	}, [activePageCount, activePageMap, activeFile, onRender]);

	if (!resumeData) return null;

	const visiblePdf = getActivePreviewLayer(previewLayers);
	const resolvedPageGap = getResumePreviewGapValue(pageGap);

	return (
		<div className={cn("grid", className)}>
			<ResumeAccessibleText data={resumeData} />
			<AnimatePresence initial={false}>
				{!visiblePdf && (
					// Holds under the first render until it's opaque, then drops out, like any replaced layer.
					<m.div
						key="loader"
						className="col-start-1 row-start-1"
						exit={{ opacity: 0 }}
						transition={reducedMotion ? INSTANT_TRANSITION : EXITING_TRANSITION}
					>
						<ResumePreviewLoader
							pageCount={getResumePreviewPageCount(resumeData)}
							pageClassName={pageClassName}
							pageGap={pageGap}
							pageLayout={pageLayout}
							pageScale={pageScale}
							showPageNumbers={showPageNumbers}
						/>
					</m.div>
				)}
				{previewLayers.map((visiblePdf) => (
					<m.div
						key={visiblePdf.id}
						aria-hidden={visiblePdf.phase !== "active"}
						data-resume-preview-template={visiblePdf.template}
						style={{ "--resume-preview-page-gap": resolvedPageGap } as MotionStyle}
						className={cn("col-start-1 row-start-1", visiblePdf.phase !== "active" && "pointer-events-none")}
						initial={{ opacity: visiblePdf.phase === "active" ? 1 : 0 }}
						animate={{ opacity: visiblePdf.phase === "active" ? 1 : 0 }}
						exit={{ opacity: 0 }}
						transition={
							reducedMotion
								? INSTANT_TRANSITION
								: visiblePdf.phase === "exiting"
									? EXITING_TRANSITION
									: INCOMING_TRANSITION
						}
						onAnimationComplete={() => {
							if (visiblePdf.phase !== "exiting") return;
							setPreviewLayers((current) => removePreviewLayer(current, visiblePdf.id));
						}}
					>
						<PdfCanvasDocument
							file={visiblePdf.file}
							onLoadSuccess={(document) => {
								setPreviewLayers((current) => setPreviewPageCount(current, visiblePdf.id, document.numPages));
							}}
						>
							{(document) => (
								<div
									dir={isRTL(resumeData.metadata.page.locale) ? "rtl" : "ltr"}
									className={cn(
										"flex justify-start gap-(--resume-preview-page-gap)",
										pageLayout === "horizontal" ? "flex-row items-start" : "flex-col items-center",
									)}
								>
									{Array.from({ length: visiblePdf.numPages }, (_, index) => {
										const pageNumber = index + 1;
										const totalPages = visiblePdf.numPages;
										const pageSize = visiblePdf.pageSizes[pageNumber];

										return (
											<PdfCanvasPage
												key={`${visiblePdf.id}-${pageNumber}`}
												document={document}
												pageSize={pageSize}
												pageNumber={pageNumber}
												pageScale={pageScale}
												totalPages={totalPages}
												className={pageClassName}
												showPageNumbers={showPageNumbers}
												caption={renderPageCaption?.({ pageNumber, totalPages })}
												overlay={
													visiblePdf.phase === "active"
														? renderPageOverlay?.({ pageIndex: index, pageMap: visiblePdf.pageMap })
														: undefined
												}
												onLoadSuccess={(_, pageSize) => {
													setPreviewLayers((current) =>
														setPreviewPageSize(current, visiblePdf.id, pageNumber, pageSize),
													);
												}}
												onRenderSuccess={() => {
													if (visiblePdf.phase !== "staged") return;

													setPreviewLayers((current) => markPreviewPageRendered(current, visiblePdf.id, pageNumber));
												}}
											/>
										);
									})}
								</div>
							)}
						</PdfCanvasDocument>
					</m.div>
				))}
			</AnimatePresence>
		</div>
	);
}
