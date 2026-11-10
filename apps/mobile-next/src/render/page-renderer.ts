import type { RenderedPage } from "./types";
import type { PageMap } from "@reactive-resume/pdf/native";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { Asset } from "expo-asset";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { Image } from "react-native";
import { fixturePageMap, fixtureIssueMarkers } from "./fixture-map";
import { rest } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { dataClient as client } from "@/data/client";
import { isFake } from "@/data/fixtures";

export type PageRenderRequest = {
	kind: "resume" | "letter";
	id: string;
	revision: string | number;
	data?: ResumeData;
	fixture?: keyof typeof fixtureImages;
	/** Public resume data is already redacted by getBySlug; renders without an account. */
	public?: boolean;
	/** Historical previews cannot fall back to another version. */
	snapshot?: boolean;
};
export type PageRenderResult = {
	pdfFile: string;
	pages: RenderedPage[];
	pageCount: number;
	revision: string | number;
	stale: boolean;
	/** Undefined for server PDFs, which carry no semantic hit map. */
	pageMap?: PageMap;
	issueMarkers?: ReturnType<typeof fixtureIssueMarkers>;
};
export interface PageRenderer {
	render(request: PageRenderRequest): Promise<PageRenderResult>;
}
const fixtureImages = {
	"page-resume-B1": require("../../assets/fixtures/page-resume-B1.png"),
	"page-resume-B6": require("../../assets/fixtures/page-resume-B6.png"),
	"page-resume-full": require("../../assets/fixtures/page-resume-full.png"),
	"page-public-full": require("../../assets/fixtures/page-public-full.png"),
	"thumb-letter-L2": require("../../assets/fixtures/thumb-letter-L2.png"),
	"thumb-resume-B11": require("../../assets/fixtures/thumb-resume-B11.png"),
	"thumb-template-onyx": require("../../assets/fixtures/thumb-template-onyx.png"),
};
const flights = new Map<string, Promise<PageRenderResult>>();
const hash = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
const rootFor = async (scope: string) => new Directory(Paths.cache, "page-render-v1", await hash(scope));
export async function clearRenderCache(scope: string) {
	const directory = await rootFor(scope);
	if (directory.exists) directory.delete();
}
async function cached(file: File): Promise<PageRenderResult | undefined> {
	try {
		const result: PageRenderResult = JSON.parse(await file.text());
		if (new File(result.pdfFile).exists && result.pages.every((page) => new File(page.uri).exists)) return result;
	} catch {
		/* A cache miss falls through to rendering. */
	}
	return;
}
export const pageRenderer: PageRenderer = {
	async render(request) {
		const fake = isFake();
		const account = getAccountScope();
		const server = getServer();
		if (request.public && (!request.data || request.kind !== "resume"))
			throw new Error("Public rendering requires public resume data.");
		const scope = fake ? "storyboard" : (account ?? (request.public ? JSON.stringify([server, "public"]) : null));
		if (!scope) throw new Error("Sign in again.");
		const current = () => fake || (getAccountScope() === account && getServer() === server);
		const root = await rootFor(scope);
		root.create({ intermediates: true, idempotent: true });
		const documentKey = await hash(
			JSON.stringify([request.kind, request.id, request.snapshot ? request.revision : null]),
		);
		const key = await hash(
			JSON.stringify([
				scope,
				request.kind,
				request.id,
				request.revision,
				request.fixture,
				request.data,
				request.snapshot,
			]),
		);
		const directory = new Directory(root, key);
		const manifest = new File(directory, "render.json");
		const latest = new File(root, `${documentKey}.json`);
		const hit = await cached(manifest);
		if (!current()) throw new Error("The account changed. Try again.");
		if (hit) return hit;
		const flight = flights.get(key);
		if (flight) return flight;
		const rendering = (async () => {
			directory.create({ intermediates: true, idempotent: true });
			const pdf = new File(directory, "document.pdf");
			let pages: RenderedPage[];
			let pageMap: PageMap | undefined;
			if (fake) {
				const source =
					fixtureImages[request.fixture ?? (request.kind === "letter" ? "thumb-letter-L2" : "page-resume-full")];
				const asset = await Asset.fromModule(source).downloadAsync();
				const uri = asset.localUri ?? asset.uri;
				const size = Image.resolveAssetSource(source);
				if (!size?.width || !size.height) throw new Error("Fixture image size unavailable.");
				const { printToFileAsync } = await import("expo-print");
				const output = await printToFileAsync({
					html: `<html><head><style>@page{margin:0}html,body{margin:0;padding:0}img{display:block;width:100%}</style></head><body><img src="data:image/png;base64,${await new File(uri).base64()}" /></body></html>`,
					width: size.width,
					height: size.height,
					margins: { left: 0, right: 0, top: 0, bottom: 0 },
				});
				new File(output.uri).copy(pdf);
				pages = [{ index: 0, uri, width: size.width, height: size.height }];
				pageMap = fixturePageMap(size.width, size.height);
			} else {
				let bytes: Uint8Array;
				try {
					const { createPreviewPipeline } = require("./pipeline") as typeof import("./pipeline");
					const pipeline = createPreviewPipeline();
					try {
						let data = request.data;
						if (!data && request.kind === "resume") {
							const document = await client.resume.getById({ id: request.id }, { context: { scope } });
							if (
								String(document.updatedAt.getTime()) !== String(request.revision) &&
								document.updatedAt.toISOString() !== request.revision
							)
								throw new Error("Document revision changed.");
							data = document.data;
						}
						if (!data && request.kind === "letter") {
							const document = await client.coverLetters.getById({ id: request.id }, { context: { scope } });
							if (document.revision !== request.revision) throw new Error("Document revision changed.");
							const { composeCoverLetter, createCoverLetterResumeData } =
								await import("@reactive-resume/resume/cover-letter");
							const { letterWords } = await import("./letter-words");
							data = createCoverLetterResumeData({
								...document,
								...composeCoverLetter(document, await letterWords(document.style.metadata.page.locale)),
							});
						}
						if (!data) throw new Error("Document not found.");
						const result = await pipeline.render({
							id: 1,
							data,
							scale: 1,
							...(request.kind === "letter" ? { renderOptions: { includeCoverLetterHeader: true } } : {}),
						});
						bytes = result.pdf;
						pageMap = result.pageMap;
						pages = result.pages.map((page) => {
							const image = new File(directory, `${page.index}.png`);
							new File(page.uri).copy(image);
							return { ...page, uri: image.uri };
						});
					} finally {
						await pipeline.dispose();
					}
				} catch (error) {
					// A server PDF cannot represent unsaved data or an arbitrary historical revision.
					if (request.data || request.public || request.kind !== "resume") throw error;
					const document = await client.resume.getById({ id: request.id }, { context: { scope } });
					if (
						String(document.updatedAt.getTime()) !== String(request.revision) &&
						document.updatedAt.toISOString() !== request.revision
					)
						throw error;
					const response = await rest(`/resumes/${encodeURIComponent(request.id)}/pdf`, {}, scope);
					if (!response.ok) throw new Error("Couldn't render the document. Try again.");
					bytes = new Uint8Array(await response.arrayBuffer());
					const { pdfPages } = await import("../../modules/pdf-pages");
					const documentPdf = await pdfPages.open(bytes);
					try {
						pages = (
							await pdfPages.rasterize(
								documentPdf.id,
								documentPdf.pages.map((_, index) => index),
								1,
							)
						).map((page) => {
							const image = new File(directory, `${page.index}.png`);
							new File(page.uri).copy(image);
							return { ...page, uri: image.uri };
						});
					} finally {
						await pdfPages.close(documentPdf.id);
					}
				}
				if (!current()) throw new Error("The account changed. Try again.");
				pdf.write(bytes);
			}
			const result = {
				pdfFile: pdf.uri,
				pages,
				pageCount: pages.length,
				revision: request.revision,
				stale: false,
				...(pageMap ? { pageMap } : {}),
				...(fake && pages[0] ? { issueMarkers: fixtureIssueMarkers(pages[0].width, pages[0].height) } : {}),
			};
			manifest.write(JSON.stringify(result));
			latest.write(JSON.stringify(result));
			return result;
		})()
			.catch(async (error) => {
				const previous = await cached(latest);
				if (previous && current()) return { ...previous, stale: true };
				throw error;
			})
			.finally(() => flights.delete(key));
		flights.set(key, rendering);
		return rendering;
	},
};
