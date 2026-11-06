import { afterEach, expect, it, vi } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";

const mocks = vi.hoisted(() => ({ preload: vi.fn(), render: vi.fn(async () => ({ blob: new Blob() })) }));
vi.mock("@reactive-resume/pdf/browser", () => ({ preloadResumePdf: mocks.preload }));
vi.mock("./render", () => ({ renderResumePdf: mocks.render }));
afterEach(() => vi.unstubAllGlobals());

it("uses the request's mirror for warm-up as well as rendering", async () => {
	let receive: ((event: { data: unknown }) => Promise<void>) | undefined;
	vi.stubGlobal("self", {
		addEventListener: (_type: string, callback: typeof receive) => {
			receive = callback;
		},
		postMessage: vi.fn(),
	});
	await import("./pdf.worker");
	const input = { data: sampleResumeData, fontMirrorUrl: "https://fonts.example/instance" };
	await receive?.({ data: { id: 1, ...input } });
	expect(mocks.preload).toHaveBeenCalledWith(sampleResumeData, input.fontMirrorUrl);
	expect(mocks.render).toHaveBeenCalledWith(input);
});
