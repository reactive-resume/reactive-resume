import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { createSectionTitleResolverForLocale } from "@/libs/resume/section-title-locale";

type ResumePdfRenderOptions = {
	includeCoverLetterHeader?: boolean;
};

type CreateResumePdfBlobExtras = {
	/** Receives the page map (header, section and item boxes) of this render; used by the editor canvas. */
	onPageMap?: (pageMap: PageMap) => void;
};

type RenderInput = { data: ResumeData; template?: Template | undefined; renderOptions?: ResumePdfRenderOptions };

export type PdfWorkerRequest = RenderInput & { id: number };
export type PdfWorkerResponse =
	| { id: number; blob: Blob; pageMap: PageMap | undefined }
	// `cause` survives the worker boundary so callers can still tell text loss apart (see `getReadableErrorMessage`).
	| { id: number; error: string; cause: string | undefined };

type Rendered = { blob: Blob; pageMap: PageMap | undefined };

/** The same render on the main thread: where workers aren't available, or the worker failed to start. */
async function renderHere({ data, template, renderOptions }: RenderInput): Promise<Rendered> {
	const [{ createResumePdfBlob }, resolveSectionTitle] = await Promise.all([
		import("@reactive-resume/pdf/browser"),
		createSectionTitleResolverForLocale(data.metadata.page.locale),
	]);
	let pageMap: PageMap | undefined;
	const blob = await createResumePdfBlob({
		data,
		template,
		...(renderOptions ? { renderOptions } : {}),
		resolveSectionTitle,
		onPageMap: (map) => {
			pageMap = map;
		},
	});
	return { blob, pageMap };
}

type Pending = { input: RenderInput; resolve(value: Rendered): void; reject(error: Error): void };

// ponytail: one worker renders in order, so a preview can wait behind one thumbnail (~0.25 s); a second worker
// for thumbnails costs another engine and font set in memory.
let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
	if (worker !== undefined) return worker;
	worker = null;
	if (typeof Worker === "undefined") return worker;
	try {
		worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module", name: "resume-pdf" });
	} catch {
		return worker;
	}
	worker.addEventListener("message", ({ data: response }: MessageEvent<PdfWorkerResponse>) => {
		const request = pending.get(response.id);
		if (!request) return;
		pending.delete(response.id);
		if ("error" in response) request.reject(new Error(response.error, { cause: response.cause }));
		else request.resolve({ blob: response.blob, pageMap: response.pageMap });
	});
	// Every render is caught inside the worker, so an error here means it couldn't start: render here instead.
	worker.addEventListener("error", () => {
		worker?.terminate();
		worker = null;
		for (const request of pending.values()) renderHere(request.input).then(request.resolve, request.reject);
		pending.clear();
	});
	return worker;
}

function render(input: RenderInput): Promise<Rendered> {
	const target = getWorker();
	if (!target) return renderHere(input);
	const id = ++nextId;
	return new Promise((resolve, reject) => {
		pending.set(id, { input, resolve, reject });
		target.postMessage({ ...input, id } satisfies PdfWorkerRequest);
	});
}

export const createResumePdfBlob = async (
	data: ResumeData,
	template?: Template,
	renderOptions?: ResumePdfRenderOptions,
	{ onPageMap }: CreateResumePdfBlobExtras = {},
) => {
	const { blob, pageMap } = await render({ data, template, ...(renderOptions ? { renderOptions } : {}) });
	if (pageMap) onPageMap?.(pageMap);
	return blob;
};
