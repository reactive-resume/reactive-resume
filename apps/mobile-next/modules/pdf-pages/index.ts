import { requireNativeModule } from "expo";

export type PdfPageSize = { width: number; height: number };
export type PdfDocument = { id: string; pages: PdfPageSize[] };
export type PageImage = PdfPageSize & { index: number; uri: string };

export const pdfPages = requireNativeModule<{
	open: (pdf: Uint8Array) => Promise<PdfDocument>;
	rasterize: (id: string, pages: number[], scale: number) => Promise<PageImage[]>;
	close: (id: string) => Promise<void>;
}>("PdfPages");
