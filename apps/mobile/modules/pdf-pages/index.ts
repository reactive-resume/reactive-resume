import { requireNativeModule } from "expo";

export type PdfPageSize = { width: number; height: number };
export type PdfDocument = { id: string; pages: PdfPageSize[] };
export type PageImage = PdfPageSize & { index: number; uri: string };

type PdfPages = {
	open: (pdf: Uint8Array) => Promise<PdfDocument>;
	rasterize: (id: string, pages: number[], scale: number) => Promise<PageImage[]>;
	close: (id: string) => Promise<void>;
};
// Looked up on first use, so modules that import the renderer load where the native module is absent (Jest).
const native = () => requireNativeModule<PdfPages>("PdfPages");
export const pdfPages: PdfPages = {
	open: (pdf) => native().open(pdf),
	rasterize: (id, pages, scale) => native().rasterize(id, pages, scale),
	close: (id) => native().close(id),
};
