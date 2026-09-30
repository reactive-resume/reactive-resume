import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { AnnotationMode, GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";
import { useEffect, useReducer, useRef } from "react";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { resolvePublicResumePdfBlob } from "./public-pdf";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";
import "pdfjs-dist/legacy/web/pdf_viewer.css";
import "./pdf-viewer.css";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

type PdfViewerProps = {
	className?: string;
	includeCoverLetterHeader?: boolean;
	publicResume?: {
		username: string;
		slug: string;
	};
} & ({ data: ResumeData; file?: never } | { file: Blob; data?: never });

type PdfViewerOptions = ConstructorParameters<typeof PDFViewer>[0] & {
	abortSignal: AbortSignal;
};

type PdfViewerState = {
	error: boolean;
	fileVersion: number;
	isReady: boolean;
	viewerHeight: number | null;
};

type PdfViewerAction =
	| { type: "error" }
	| { type: "fileLoaded" }
	| { type: "height"; height: number }
	| { type: "ready" }
	| { type: "resetForData" }
	| { type: "viewerLoading" };

const INITIAL_PDF_VIEWER_STATE: PdfViewerState = {
	error: false,
	fileVersion: 0,
	isReady: false,
	viewerHeight: null,
};

const clearPdfViewerDocument = (pdfViewer: PDFViewer) => {
	(pdfViewer.setDocument as (document: PDFDocumentProxy | null) => void)(null);
};

function pdfViewerReducer(state: PdfViewerState, action: PdfViewerAction): PdfViewerState {
	switch (action.type) {
		case "resetForData":
		case "fileLoaded":
			return {
				...INITIAL_PDF_VIEWER_STATE,
				fileVersion: state.fileVersion + 1,
			};
		case "viewerLoading":
			return { ...state, error: false, isReady: false, viewerHeight: null };
		case "height":
			return action.height > 0 && action.height !== state.viewerHeight
				? { ...state, viewerHeight: action.height }
				: state;
		case "ready":
			return state.isReady ? state : { ...state, isReady: true };
		case "error":
			return { ...state, error: true, isReady: false };
	}
}

/** Renders a resume's PDF from its data, or an existing PDF file (the ATS checker's upload). */
export function PdfViewer({
	className,
	data,
	file: givenFile,
	publicResume,
	includeCoverLetterHeader,
}: PdfViewerProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const viewerRef = useRef<HTMLDivElement>(null);
	const fileRef = useRef<Blob | null>(null);
	const [{ error, fileVersion, isReady, viewerHeight }, dispatch] = useReducer(
		pdfViewerReducer,
		INITIAL_PDF_VIEWER_STATE,
	);

	useEffect(() => {
		let isCancelled = false;

		fileRef.current = null;
		dispatch({ type: "resetForData" });

		const createPdf = (): Promise<Blob> => {
			if (givenFile) return Promise.resolve(givenFile);
			if (!data) return Promise.reject(new Error("PdfViewer needs data or a file."));
			if (publicResume) return resolvePublicResumePdfBlob({ data, publicResume });
			return includeCoverLetterHeader
				? createResumePdfBlob(data, undefined, { includeCoverLetterHeader: true })
				: createResumePdfBlob(data);
		};

		void createPdf()
			.then((blob) => {
				if (isCancelled) return;

				fileRef.current = blob;
				dispatch({ type: "fileLoaded" });
			})
			.catch((error: unknown) => {
				if (!isCancelled) {
					console.error("Failed to generate public resume PDF", error);
					dispatch({ type: "error" });
				}
			});

		return () => {
			isCancelled = true;
		};
	}, [data, givenFile, publicResume, includeCoverLetterHeader]);

	useEffect(() => {
		void fileVersion;

		const root = rootRef.current;
		const container = containerRef.current;
		const viewer = viewerRef.current;
		const file = fileRef.current;

		if (!file || !root || !container || !viewer) return;

		let isCancelled = false;
		let animationFrameId = 0;
		let resizeObserver: ResizeObserver | undefined;
		const abortController = new AbortController();
		let loadingTask: PDFDocumentLoadingTask | undefined;
		let pdfDocument: PDFDocumentProxy | undefined;
		let pdfViewer: PDFViewer | undefined;

		const eventBus = new EventBus();
		const linkService = new PDFLinkService({
			eventBus,
			externalLinkTarget: LinkTarget.BLANK,
			externalLinkRel: "noreferrer",
		});

		const syncViewerHeight = () => {
			if (isCancelled) return;

			window.cancelAnimationFrame(animationFrameId);
			animationFrameId = window.requestAnimationFrame(() => {
				if (isCancelled) return;

				const nextHeight = Math.ceil(viewer.scrollHeight);
				dispatch({ type: "height", height: nextHeight });
				pdfViewer?.update();
			});
		};

		// The overlay stays until a page has actually painted, so it never lifts onto a blank viewer.
		const reveal = () => {
			syncViewerHeight();
			dispatch({ type: "ready" });
		};

		const setInitialScale = () => {
			if (!isCancelled && pdfViewer) {
				pdfViewer.currentScaleValue = "page-width";
				syncViewerHeight();
			}
		};

		eventBus.on("pagesinit", setInitialScale);
		eventBus.on("pagesloaded", syncViewerHeight);
		eventBus.on("pagerendered", reveal);
		viewer.replaceChildren();
		dispatch({ type: "viewerLoading" });
		resizeObserver = new ResizeObserver(syncViewerHeight);
		resizeObserver.observe(viewer);

		const loadDocument = async () => {
			if (isCancelled) return;
			const arrayBuffer = await file.arrayBuffer();

			if (!isCancelled) {
				loadingTask = getDocument({
					data: new Uint8Array(arrayBuffer),
					docBaseUrl: window.location.href,
				});

				const nextDocument = await loadingTask.promise;

				if (isCancelled) {
					void loadingTask.destroy();
				} else {
					pdfDocument = nextDocument;
					const pdfViewerOptions = {
						annotationMode: AnnotationMode.ENABLE_FORMS,
						container,
						eventBus,
						linkService,
						removePageBorders: true,
						abortSignal: abortController.signal,
						viewer,
					} satisfies PdfViewerOptions;

					pdfViewer = new PDFViewer(pdfViewerOptions);

					linkService.setViewer(pdfViewer);
					pdfViewer.setDocument(pdfDocument);
					linkService.setDocument(pdfDocument);
					syncViewerHeight();
				}
			}
		};

		void loadDocument().catch((error: unknown) => {
			if (!isCancelled) {
				console.error("Failed to render public resume PDF with PDF.js", error);
				dispatch({ type: "error" });
			}
		});

		return () => {
			isCancelled = true;
			eventBus.off("pagesinit", setInitialScale);
			eventBus.off("pagesloaded", syncViewerHeight);
			eventBus.off("pagerendered", reveal);
			abortController.abort();
			window.cancelAnimationFrame(animationFrameId);
			resizeObserver?.disconnect();
			if (pdfViewer) clearPdfViewerDocument(pdfViewer);
			void loadingTask?.destroy();
			viewer.replaceChildren();
		};
	}, [fileVersion]);

	return (
		<div
			ref={rootRef}
			// Until the real height is known, reserve an A4 page so the viewer doesn't grow from 192px.
			className={cn("pdf-viewer relative bg-sunken", viewerHeight ? "min-h-0" : "aspect-[210/297]", className)}
			style={viewerHeight ? { height: viewerHeight } : undefined}
		>
			<div ref={containerRef} className="absolute inset-0 overflow-visible">
				<div ref={viewerRef} className="pdfViewer" />
			</div>

			{error ? (
				<div className="absolute inset-0 flex items-center justify-center bg-bg px-6 text-center text-sm text-ink-3">
					Unable to display PDF preview.
				</div>
			) : (
				<div
					aria-hidden={isReady}
					className={cn(
						"absolute inset-0 flex items-center justify-center bg-bg transition-[opacity,visibility] ease-enter",
						isReady ? "invisible opacity-0 duration-[calc(var(--d2)*0.7)]" : "duration-standard",
					)}
				>
					<Spinner className="size-6" />
				</div>
			)}
		</div>
	);
}
