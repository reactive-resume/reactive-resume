import type { PreviewPageSize } from "./preview.shared.utils";
import type { ResumeThumbnailSize } from "./resume-thumbnail.shared";
import type { QueryClient } from "@tanstack/react-query";
import { getResumeThumbnailRenderSize } from "./resume-thumbnail.shared";

const canvasToBlob = (canvas: HTMLCanvasElement) =>
	new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Failed to create resume thumbnail image."));
				return;
			}

			resolve(blob);
		}, "image/png");
	});

export const createPdfFirstPageImageUrl = async (file: Blob, targetSize: ResumeThumbnailSize, signal?: AbortSignal) => {
	signal?.throwIfAborted();
	const { AnnotationMode, GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

	const arrayBuffer = await file.arrayBuffer();
	signal?.throwIfAborted();
	const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
	let pdfDocument: Awaited<typeof loadingTask.promise> | undefined;
	let renderTask: { cancel: () => void } | undefined;
	let destruction: Promise<void> | undefined;
	const destroy = () => (destruction ??= loadingTask.destroy());
	const abort = () => {
		renderTask?.cancel();
		void destroy();
	};
	signal?.addEventListener("abort", abort, { once: true });

	try {
		signal?.throwIfAborted();
		pdfDocument = await loadingTask.promise;
		signal?.throwIfAborted();
		const page = await pdfDocument.getPage(1);

		try {
			signal?.throwIfAborted();
			const baseViewport = page.getViewport({ scale: 1 });
			const pageSize: PreviewPageSize = { height: baseViewport.height, width: baseViewport.width };
			const renderSize = getResumeThumbnailRenderSize(pageSize, targetSize);

			const canvas = document.createElement("canvas");
			const canvasContext = canvas.getContext("2d");

			if (!canvasContext) throw new Error("Failed to create resume thumbnail canvas context.");

			canvas.height = renderSize.height;
			canvas.width = renderSize.width;

			const viewport = page.getViewport({ scale: renderSize.scale });
			const task = page.render({
				canvas,
				canvasContext,
				viewport,
				annotationMode: AnnotationMode.DISABLE,
				background: "white",
			});
			renderTask = task;

			await task.promise;
			signal?.throwIfAborted();

			const image = await canvasToBlob(canvas);
			signal?.throwIfAborted();
			return URL.createObjectURL(image);
		} finally {
			page.cleanup();
		}
	} catch (error) {
		if (signal?.aborted) throw new DOMException("Thumbnail generation aborted.", "AbortError");
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		void destroy();
	}
};

const releasedCaches = new Map<string, WeakSet<object>>();

/**
 * Revokes a thumbnail's object URL once its query is replaced or dropped from the cache, for queries whose
 * key starts with `key` (e.g. "resume-thumbnail"). Safe to call on every render.
 */
export function releaseThumbnailUrls(queryClient: QueryClient, key: string) {
	const queryCache = queryClient.getQueryCache();
	const seen = releasedCaches.get(key) ?? new WeakSet<object>();
	releasedCaches.set(key, seen);
	if (seen.has(queryCache)) return;
	seen.add(queryCache);

	// Cache updates have already replaced state.data, so retain each query's previous URL.
	const urls = new WeakMap<object, unknown>(
		queryCache.findAll({ queryKey: [key] }).map((query) => [query, query.state.data]),
	);
	queryCache.subscribe((event) => {
		if (event.query.queryKey[0] !== key) return;
		if (event.type !== "updated" && event.type !== "removed") return;
		const previousUrl = urls.get(event.query);
		const url = event.type === "removed" ? undefined : event.query.state.data;
		if (typeof previousUrl === "string" && previousUrl !== url) URL.revokeObjectURL(previousUrl);
		if (typeof url === "string") urls.set(event.query, url);
		else urls.delete(event.query);
	});
}
