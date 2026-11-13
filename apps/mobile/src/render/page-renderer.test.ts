let mockScope: string | null = null;
const mockFiles = new Map<string, string | Uint8Array>([["file://source.png", "png"]]);
const pdfResponse = (status = 200) => ({ ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(4) });
const mockRest = jest.fn(async (_path: string, _init?: unknown) => pdfResponse());
jest.mock("@/auth/session", () => ({ getAccountScope: () => mockScope, getServer: () => "https://example.org" }));
jest.mock("@/api/client", () => ({ rest: (path: string, init?: unknown) => mockRest(path, init) }));
jest.mock("@/data/client", () => ({ dataClient: {} }));
jest.mock("expo/fetch", () => ({ fetch: async () => pdfResponse() }));
jest.mock("../../modules/pdf-pages", () => ({
	pdfPages: {
		open: async () => ({
			id: "pdf",
			pages: [
				{ width: 595, height: 842 },
				{ width: 595, height: 842 },
			],
		}),
		rasterize: async (_id: string, pages: number[]) =>
			pages.map((index) => ({ index, uri: "file://source.png", width: 595, height: 842 })),
		close: async () => {},
	},
}));
jest.mock("@/data/fixtures", () => ({ isFake: () => false }));
jest.mock("expo-asset", () => ({ Asset: {} }));
jest.mock("expo-crypto", () => ({
	CryptoDigestAlgorithm: { SHA256: "sha256" },
	digestStringAsync: async (_kind: string, value: string) => encodeURIComponent(value),
}));
jest.mock("expo-file-system", () => {
	const uriOf = (parts: unknown[]) =>
		parts.map((part) => (typeof part === "string" ? part : (part as { uri: string }).uri)).join("/");
	class Directory {
		uri: string;
		constructor(...parts: unknown[]) {
			this.uri = uriOf(parts);
		}
		create() {}
	}
	class File {
		uri: string;
		constructor(...parts: unknown[]) {
			this.uri = uriOf(parts);
		}
		get exists() {
			return mockFiles.has(this.uri);
		}
		async text() {
			const value = mockFiles.get(this.uri);
			if (typeof value !== "string") throw new Error("No file");
			return value;
		}
		write(value: string | Uint8Array) {
			mockFiles.set(this.uri, value);
		}
		copy(target: File) {
			const value = mockFiles.get(this.uri);
			if (!value) throw new Error("No source");
			mockFiles.set(target.uri, value);
		}
	}
	return { Directory, File, Paths: { cache: "file://cache" } };
});
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { pageRenderer } from "./page-renderer";
test("signed-out public resume data renders and last good pages remain available offline", async () => {
	await expect(pageRenderer.render({ kind: "resume", id: "private", revision: 1 })).rejects.toThrow("Sign in");
	const request = { kind: "resume" as const, id: "public-resume", revision: 1, public: true, data: defaultResumeData };
	const first = await pageRenderer.render(request);
	expect(first.pageCount).toBe(2);
	mockRest.mockRejectedValueOnce(new Error("Offline"));
	const offline = await pageRenderer.render({ ...request, revision: 2 });
	expect(offline.pdfFile).toBe(first.pdfFile);
	expect(offline.stale).toBe(true);
	expect(offline.revision).toBe(1);
});
test("a render completing after account change cannot return old account's PDF", async () => {
	mockScope = "alex";
	mockRest.mockImplementationOnce(async () => {
		mockScope = "other";
		return pdfResponse();
	});
	await expect(
		pageRenderer.render({ kind: "resume", id: "owned", revision: 1, data: defaultResumeData }),
	).rejects.toThrow("account changed");
});
test("historical previews never fall back to another version's last good PDF", async () => {
	mockScope = "alex";
	const request = {
		kind: "resume" as const,
		id: "history",
		revision: "first",
		data: defaultResumeData,
		snapshot: true,
	};
	await pageRenderer.render(request);
	mockRest.mockRejectedValueOnce(new Error("Offline"));
	await expect(pageRenderer.render({ ...request, revision: "second" })).rejects.toThrow("Offline");
});
test("a server without preview renders shows the saved resume's PDF", async () => {
	mockScope = "alex";
	mockRest.mockResolvedValueOnce(pdfResponse(404));
	const result = await pageRenderer.render({ kind: "resume", id: "draft", revision: 1, data: defaultResumeData });
	expect(mockRest.mock.calls.slice(-2).map(([path]) => path)).toEqual(["/resumes/pdf-renders", "/resumes/draft/pdf"]);
	expect(result).toMatchObject({ pageCount: 2, stale: false });
	expect(result.pages.map((page) => page.uri)).toEqual([
		expect.stringMatching(/0\.png$/),
		expect.stringMatching(/1\.png$/),
	]);
});
