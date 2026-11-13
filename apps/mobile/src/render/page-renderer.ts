import type { PageImage } from "../../modules/pdf-pages";
import type { CoverLetterContent } from "@reactive-resume/schema/cover-letter/data";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { Image, Platform } from "react-native";
import { pdfPages } from "../../modules/pdf-pages";
import { rest } from "@/api/client";
import { getAccountScope, getServer } from "@/auth/session";
import { dataClient as client } from "@/data/client";
import { isFake } from "@/data/fixtures";
import { assetFile } from "@/dev/storyboard/asset-file";

export type RenderedPage = PageImage;
export type PageRenderRequest = {
	kind: "resume" | "letter";
	id: string;
	revision: string | number;
	/** Resume data to render, an unsaved draft included; the saved resume when omitted. */
	data?: ResumeData;
	/** Letter content to render, an unsaved draft included; the saved letter when omitted. */
	letter?: CoverLetterContent;
	fixture?: keyof typeof fixtureImages;
	/** Public resume data is already redacted by getBySlug; renders without an account. */
	public?: boolean;
	/** A shared resume's address: signed out, the public PDF route renders it. */
	publicPath?: { username: string; slug: string };
	/** Historical previews cannot fall back to another version. */
	snapshot?: boolean;
};
export type PageRenderResult = {
	pdfFile: string;
	pages: RenderedPage[];
	pageCount: number;
	revision: string | number;
	stale: boolean;
};
export interface PageRenderer {
	render(request: PageRenderRequest): Promise<PageRenderResult>;
}
let androidPrints: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
	const run = androidPrints.then(task, task);
	androidPrints = run;
	return run;
}
/** A print that never answers fails after `ms` instead of holding the queue (and the storyboard) forever. */
function within<T>(task: () => Promise<T>, ms: number): () => Promise<T> {
	return () =>
		Promise.race([
			task(),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Print timed out")), ms)),
		]);
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
/** Pixels per PDF point: an A4 page is about 1190 px wide, sharp on a 3× phone at full width and at 2× zoom. */
const RASTER_SCALE = 2;
const failed = () => new Error("Couldn't render the document. Try again.");
const flights = new Map<string, Promise<PageRenderResult>>();
const hash = (value: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value);
const rootFor = async (scope: string) => new Directory(Paths.cache, "page-render-v2", await hash(scope));
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
const savedRevision = (updatedAt: Date, revision: string | number) =>
	String(updatedAt.getTime()) === String(revision) || updatedAt.toISOString() === revision;
const bytesOf = async (response: Response) => {
	if (!response.ok) throw failed();
	return new Uint8Array(await response.arrayBuffer());
};
/** A server from before preview renders answers 404/405; a body over its limit (an embedded picture) 413. */
const unsupported = (response: Response) => [404, 405, 413].includes(response.status);
const post = (path: `/${string}`, body: unknown, scope: string) =>
	rest(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, scope);

/** The server renders every PDF: the draft when the server can, otherwise the saved document. */
async function serverPdf(request: PageRenderRequest, scope: string): Promise<Uint8Array> {
	if (request.public && request.publicPath && !getAccountScope()) {
		const { username, slug } = request.publicPath;
		const path = `/api/resumes/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/pdf`;
		return bytesOf((await expoFetch(`${getServer()}${path}`)) as unknown as Response);
	}
	if (request.kind === "resume") {
		let data = request.data;
		if (!data) {
			const document = await client.resume.getById({ id: request.id }, { context: { scope } });
			if (!savedRevision(document.updatedAt, request.revision)) throw new Error("Document revision changed.");
			data = document.data;
		}
		const response = await post("/resumes/pdf-renders", { data }, scope);
		// Public and historical data has no saved stand-in.
		if (!unsupported(response) || request.public || request.snapshot) return bytesOf(response);
		return bytesOf(await rest(`/resumes/${encodeURIComponent(request.id)}/pdf`, {}, scope));
	}
	const saved = request.letter
		? undefined
		: await client.coverLetters.getById({ id: request.id }, { context: { scope } });
	if (saved && saved.revision !== request.revision && !String(request.revision).startsWith(`${saved.revision}:`))
		throw new Error("Document revision changed.");
	const letter = request.letter ?? saved;
	if (!letter) throw new Error("Document not found.");
	const { letterWords } = await import("./letter-words");
	const localized = await letterWords(letter.style.metadata.page.locale);
	const words = {
		greeting: localized.greeting("{name}"),
		teamGreeting: localized.teamGreeting,
		hiringTeam: localized.hiringTeam,
		signOff: localized.signOff,
	};
	const response = await post("/cover-letters/pdf-renders", { letter: letterContent(letter), words }, scope);
	if (!unsupported(response) || request.snapshot) return bytesOf(response);
	const query = new URLSearchParams(Object.entries(words).map(([key, value]) => [`words[${key}]`, value]));
	return bytesOf(await rest(`/cover-letters/${encodeURIComponent(request.id)}/exports/pdf?${query}`, {}, scope));
}
/** Only the fields the render endpoint takes; a saved letter also carries ids, links and dates. */
const letterContent = (letter: CoverLetterContent): CoverLetterContent => ({
	name: letter.name,
	recipient: letter.recipient,
	content: letter.content,
	greeting: letter.greeting,
	signOff: letter.signOff,
	style: letter.style,
	layout: letter.layout,
	recipientName: letter.recipientName,
	recipientCompany: letter.recipientCompany,
	letterDate: letter.letterDate,
});
async function rasterize(bytes: Uint8Array, directory: Directory): Promise<RenderedPage[]> {
	const document = await pdfPages.open(bytes);
	try {
		const images = await pdfPages.rasterize(
			document.id,
			document.pages.map((_, index) => index),
			RASTER_SCALE,
		);
		return images.map((page) => {
			const image = new File(directory, `${page.index}.png`);
			new File(page.uri).copy(image);
			return { ...page, uri: image.uri };
		});
	} finally {
		await pdfPages.close(document.id);
	}
}
async function fixturePages(request: PageRenderRequest, pdf: File): Promise<RenderedPage[]> {
	const source = fixtureImages[request.fixture ?? (request.kind === "letter" ? "thumb-letter-L2" : "page-resume-full")];
	const uri = await assetFile(source);
	const size = Image.resolveAssetSource(source);
	if (!size?.width || !size.height) throw new Error("Fixture image size unavailable.");
	const { printToFileAsync } = await import("expo-print");
	const src = `data:image/png;base64,${await new File(uri).base64()}`;
	const { width, height } = size;
	const print = () =>
		printToFileAsync({
			html: `<html><head><style>@page{margin:0}html,body{margin:0;padding:0}img{display:block;width:100%}</style></head><body><img src="${src}" /></body></html>`,
			width,
			height,
			margins: { left: 0, right: 0, top: 0, bottom: 0 },
		});
	// Android's print WebView sometimes never answers, most often when several prints start at once (a builder
	// screen renders four fixtures together), which left the storyboard waiting forever: print one at a time
	// there, and give up on a print that hangs.
	// ponytail: one retry; a second hang surfaces as the render's error state.
	const output = await (Platform.OS === "android"
		? oneAtATime(within(print, 15_000)).catch(() => oneAtATime(within(print, 15_000)))
		: print());
	new File(output.uri).copy(pdf);
	return [{ index: 0, uri, width, height }];
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
				request.letter,
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
			if (fake) pages = await fixturePages(request, pdf);
			else {
				const bytes = await serverPdf(request, scope);
				if (!current()) throw new Error("The account changed. Try again.");
				pages = await rasterize(bytes, directory);
				pdf.write(bytes);
			}
			const result = { pdfFile: pdf.uri, pages, pageCount: pages.length, revision: request.revision, stale: false };
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
