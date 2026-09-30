import type { PreviewPageSize } from "./preview.shared.utils";
import type {
	PDFDocumentLoadingTask,
	PDFDocumentProxy,
	PDFPageProxy,
	RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ReactNode } from "react";
import {
	AnnotationMode,
	GlobalWorkerOptions,
	getDocument,
	RenderingCancelledException,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { DEFAULT_PDF_PAGE_SIZE, getPreviewCanvasScale, getScaledPreviewPageSize } from "./preview.shared.utils";

GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

type PdfCanvasDocumentProps = {
	children: (document: PDFDocumentProxy) => ReactNode;
	file: Blob;
	onLoadSuccess: (document: PDFDocumentProxy) => void;
};

type PdfCanvasPageProps = {
	caption?: ReactNode;
	className?: string | undefined;
	overlay?: ReactNode;
	document: PDFDocumentProxy;
	onLoadSuccess: (pageNumber: number, pageSize: PreviewPageSize) => void;
	onRenderSuccess?: () => void;
	pageNumber: number;
	pageScale: number;
	pageSize?: PreviewPageSize | undefined;
	showPageNumbers: boolean;
	totalPages: number;
};

const isRenderingCancelledError = (error: unknown) =>
	error instanceof RenderingCancelledException ||
	(typeof error === "object" && error !== null && "name" in error && error.name === "RenderingCancelledException");

// A new scale for a page already on the canvas (the assistant's column opening, zoom, a window resize) is drawn
// once it has held this long; meanwhile the canvas stretches its last bitmap to the page's new size.
const RESCALE_SETTLE_MS = 150;

export function PdfCanvasDocument({ children, file, onLoadSuccess }: PdfCanvasDocumentProps) {
	const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
	const onLoadSuccessRef = useRef(onLoadSuccess);

	useEffect(() => {
		onLoadSuccessRef.current = onLoadSuccess;
	}, [onLoadSuccess]);

	useEffect(() => {
		let isCancelled = false;
		let loadingTask: PDFDocumentLoadingTask | undefined;

		const loadDocument = async () => {
			setDocument(null);
			if (isCancelled) return;

			const arrayBuffer = await file.arrayBuffer();

			if (!isCancelled) {
				loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
				const pdfDocument = await loadingTask.promise;

				if (isCancelled) {
					void loadingTask.destroy();
				} else {
					setDocument(pdfDocument);
					onLoadSuccessRef.current(pdfDocument);
				}
			}
		};

		void loadDocument().catch((error: unknown) => {
			if (isCancelled) return;

			console.error("Failed to load PDF document", error);
		});

		return () => {
			isCancelled = true;
			void loadingTask?.destroy();
		};
	}, [file]);

	if (!document) return null;

	return children(document);
}

export function PdfCanvasPage({
	caption,
	className,
	overlay,
	document,
	onLoadSuccess,
	onRenderSuccess,
	pageNumber,
	pageScale,
	pageSize = DEFAULT_PDF_PAGE_SIZE,
	showPageNumbers,
	totalPages,
}: PdfCanvasPageProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const onLoadSuccessRef = useRef(onLoadSuccess);
	const onRenderSuccessRef = useRef(onRenderSuccess);
	// The document and page whose bitmap the canvas holds.
	const drawnRef = useRef<{ document: PDFDocumentProxy; pageNumber: number } | null>(null);
	const scaledPageSize = getScaledPreviewPageSize(pageSize, pageScale);

	useEffect(() => {
		onLoadSuccessRef.current = onLoadSuccess;
		onRenderSuccessRef.current = onRenderSuccess;
	}, [onLoadSuccess, onRenderSuccess]);

	useEffect(() => {
		let isCancelled = false;
		let renderTask: RenderTask | undefined;

		const drawPage = async (page: PDFPageProxy, canvas: HTMLCanvasElement) => {
			if (isCancelled) {
				page.cleanup();
				return;
			}

			const baseViewport = page.getViewport({ scale: 1 });
			const pageSize = { height: baseViewport.height, width: baseViewport.width };

			onLoadSuccessRef.current(pageNumber, pageSize);

			const width = baseViewport.width * pageScale;
			const height = baseViewport.height * pageScale;
			const renderScale = getPreviewCanvasScale(width, height);
			// Drawn off-screen and copied over in one step, so the page never shows a blank frame between renders.
			const buffer = globalThis.document.createElement("canvas");
			const bufferContext = buffer.getContext("2d");
			const canvasContext = canvas.getContext("2d");

			if (!bufferContext || !canvasContext) return;

			buffer.width = Math.floor(width * renderScale);
			buffer.height = Math.floor(height * renderScale);

			// PDF.js positions glyphs in physical coordinates, even inside an RTL resume page.
			bufferContext.direction = "ltr";

			const viewport = page.getViewport({ scale: pageScale });
			const transform = [renderScale, 0, 0, renderScale, 0, 0];

			renderTask = page.render({
				canvas: buffer,
				canvasContext: bufferContext,
				viewport,
				transform,
				annotationMode: AnnotationMode.DISABLE,
				background: "white",
			});

			await renderTask.promise;
			renderTask = undefined;

			if (isCancelled) return;

			canvas.width = buffer.width;
			canvas.height = buffer.height;
			canvasContext.drawImage(buffer, 0, 0);
			drawnRef.current = { document, pageNumber };
			onRenderSuccessRef.current?.();
		};

		const renderPage = async () => {
			const canvas = canvasRef.current;
			if (!canvas) return;

			const page = await document.getPage(pageNumber);

			await drawPage(page, canvas).finally(() => page.cleanup());
		};

		const drawn = drawnRef.current;
		const rescaling = drawn?.document === document && drawn.pageNumber === pageNumber;
		const timeoutId = window.setTimeout(
			() => {
				void renderPage().catch((error: unknown) => {
					if (isRenderingCancelledError(error)) return;

					console.error(`Failed to render PDF page ${pageNumber}`, error);
				});
			},
			rescaling ? RESCALE_SETTLE_MS : 0,
		);

		return () => {
			isCancelled = true;
			window.clearTimeout(timeoutId);
			renderTask?.cancel();
		};
	}, [document, pageNumber, pageScale]);

	return (
		<figure className="shrink-0">
			{caption ??
				(showPageNumbers ? (
					<figcaption className="mb-1 text-[0.625rem] font-medium text-ink-3">
						Page {pageNumber} of {totalPages}
					</figcaption>
				) : null)}

			<div style={scaledPageSize} className={cn("relative aspect-page overflow-hidden rounded-md", className)}>
				<canvas ref={canvasRef} aria-label={`Resume page ${pageNumber} of ${totalPages}`} className="block size-full" />
				{overlay}
			</div>
		</figure>
	);
}
