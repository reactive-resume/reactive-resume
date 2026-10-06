import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export type RasterizedPdfPage = {
	width: number;
	height: number;
	data: Uint8Array;
};

type RasterCanvas = {
	canvas: HTMLCanvasElement;
	context: CanvasRenderingContext2D;
};

type RasterCanvasFactory = {
	create(width: number, height: number): RasterCanvas;
	destroy(canvas: RasterCanvas): void;
};

export async function rasterizePdf(bytes: Uint8Array): Promise<readonly RasterizedPdfPage[]> {
	const standardFontDataPath = fileURLToPath(
		new URL("standard_fonts/", import.meta.resolve("pdfjs-dist/package.json")),
	).replaceAll("\\", "/");
	const standardFontDataUrl = standardFontDataPath.endsWith("/") ? standardFontDataPath : `${standardFontDataPath}/`;

	const loadingTask = getDocument({
		data: bytes,
		standardFontDataUrl,
	});
	const pages: RasterizedPdfPage[] = [];

	try {
		const document = await loadingTask.promise;
		// Use PDF.js's canvas implementation: a separately resolved native canvas can reject its Path2D objects.
		const canvasFactory = document.canvasFactory as RasterCanvasFactory;
		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			const page = await document.getPage(pageNumber);
			let surface: RasterCanvas | undefined;
			try {
				const viewport = page.getViewport({ scale: 1.5 });
				const width = Math.ceil(viewport.width);
				const height = Math.ceil(viewport.height);
				surface = canvasFactory.create(width, height);
				const { canvas, context } = surface;

				await page.render({
					canvas,
					canvasContext: context,
					viewport,
				}).promise;
				pages.push({
					width,
					height,
					data: Uint8Array.from(context.getImageData(0, 0, width, height).data),
				});
			} finally {
				if (surface) canvasFactory.destroy(surface);
				page.cleanup();
			}
		}
	} finally {
		await loadingTask.destroy();
	}

	return pages;
}
