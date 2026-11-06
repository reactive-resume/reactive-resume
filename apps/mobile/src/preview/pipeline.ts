import type { PdfDocument } from "../../modules/pdf-pages";
import type { RenderRequest, RenderedPages } from "./types";
import { nativeEngine } from "@reactive-resume/forme-native";
import { renderResumePdf } from "@reactive-resume/pdf/native";
import { pdfPages } from "../../modules/pdf-pages";
import { getFontMirrorUrl } from "./font-source";
import { configurePreviewResources, readPreviewImage } from "./resources";
import { getServer } from "@/auth/session";

/** A pipeline belongs to one viewer. Zoom/scroll rasterizes the existing PDF without rerunning templates. */
export function createPreviewPipeline() {
	configurePreviewResources();
	let current:
		| {
				request: RenderRequest;
				result: RenderedPages;
				document: PdfDocument;
				server: string;
				fontMirrorUrl: string | undefined;
		  }
		| undefined;
	let previous: PdfDocument | undefined;
	let disposed = false;
	const close = (document: PdfDocument | undefined) => (document ? pdfPages.close(document.id) : Promise.resolve());

	return {
		async render(request: RenderRequest): Promise<RenderedPages> {
			if (disposed) throw new Error("Preview closed");
			const server = getServer();
			const fontMirrorUrl = await getFontMirrorUrl(server);
			if (disposed || server !== getServer()) throw new Error("Preview server changed");
			if (
				!current ||
				current.server !== server ||
				current.fontMirrorUrl !== fontMirrorUrl ||
				current.request.data !== request.data ||
				current.request.template !== request.template ||
				current.request.renderOptions !== request.renderOptions
			) {
				let pageMap: RenderedPages["pageMap"] = { pages: [], nodes: [] };
				let lostCharacters: string[] = [];
				let hasTextLoss = false;
				const pdf = await renderResumePdf(nativeEngine, {
					data: request.data,
					template: request.template,
					renderOptions: request.renderOptions,
					readImage: (source) => readPreviewImage(source, server),
					fontMirrorUrl,
					onPageMap: (map) => {
						pageMap = map;
					},
					onLostCharacters: (characters) => {
						lostCharacters = characters;
						hasTextLoss = true;
					},
				});
				if (disposed || server !== getServer()) throw new Error("Preview server changed");
				const document = await pdfPages.open(pdf);
				if (disposed || server !== getServer()) {
					await close(document);
					throw new Error("Preview closed");
				}
				// Keep the preceding PNGs alive while expo-image crossfades to this document.
				await close(previous);
				previous = current?.document;
				current = {
					server,
					fontMirrorUrl,
					request,
					document,
					result: {
						requestId: request.id,
						pageCount: document.pages.length,
						pages: [],
						pageMap,
						lostCharacters,
						hasTextLoss,
						pdf,
					},
				};
			}
			const pageCount = current.document.pages.length;
			const pages =
				request.pages?.filter((index) => index >= 0 && index < pageCount) ??
				current.document.pages.map((_, index) => index);
			const rendered = await pdfPages.rasterize(current.document.id, [...new Set(pages)], request.scale);
			return { ...current.result, requestId: request.id, pages: rendered };
		},
		async dispose() {
			disposed = true;
			await Promise.all([close(previous), close(current?.document)]);
			previous = undefined;
			current = undefined;
		},
	};
}
