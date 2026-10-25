import type { PdfWorkerRequest } from "./pdf-document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";

const mocks = vi.hoisted(() => ({ renderHere: vi.fn() }));
vi.mock("@reactive-resume/pdf/browser", () => ({ createResumePdfBlob: mocks.renderHere }));

const pageMap = { pages: [{ width: 595, height: 842 }], nodes: [] };

/** Stands in for the browser's Worker: `reply` decides what it sends back for each request. */
function stubWorker(reply: (request: PdfWorkerRequest, worker: EventTarget) => void) {
	class FakeWorker extends EventTarget {
		postMessage(request: PdfWorkerRequest) {
			queueMicrotask(() => reply(request, this));
		}
		terminate() {}
	}
	vi.stubGlobal("Worker", FakeWorker);
}

beforeEach(() => {
	vi.resetModules();
	mocks.renderHere.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createResumePdfBlob", () => {
	it("renders on the main thread when the worker can't start", async () => {
		const blob = new Blob(["%PDF"], { type: "application/pdf" });
		mocks.renderHere.mockImplementation(({ onPageMap }) => {
			onPageMap(pageMap);
			return Promise.resolve(blob);
		});
		stubWorker((_request, worker) => worker.dispatchEvent(new Event("error")));
		const { createResumePdfBlob } = await import("./pdf-document");
		const onPageMap = vi.fn();

		await expect(createResumePdfBlob(sampleResumeData, undefined, { onPageMap })).resolves.toBe(blob);
		expect(onPageMap).toHaveBeenCalledWith(pageMap);
		// Later renders skip the broken worker.
		await createResumePdfBlob(sampleResumeData);
		expect(mocks.renderHere).toHaveBeenCalledTimes(2);
	});
});
