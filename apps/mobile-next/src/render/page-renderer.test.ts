let mockScope: string | null = null;
const mockFiles = new Map<string, string | Uint8Array>([["file://source.png", "png"]]);
const mockRender = jest.fn(async () => ({
	pdf: new Uint8Array([37, 80, 68, 70]),
	pages: [{ index: 0, uri: "file://source.png", width: 595, height: 842 }],
}));
jest.mock("@/auth/session", () => ({ getAccountScope: () => mockScope, getServer: () => "https://example.org" }));
jest.mock("@/api/client", () => ({ rest: jest.fn() }));
jest.mock("@/data/client", () => ({ dataClient: {} }));
jest.mock("@/data/fixtures", () => ({ isFake: () => false }));
jest.mock("expo-asset", () => ({ Asset: {} }));
jest.mock("expo-crypto", () => ({
	CryptoDigestAlgorithm: { SHA256: "sha256" },
	digestStringAsync: async (_kind: string, value: string) => encodeURIComponent(value),
}));
jest.mock("./pipeline", () => ({
	createPreviewPipeline: () => ({ render: () => mockRender(), dispose: async () => {} }),
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
	expect(first.pageCount).toBe(1);
	mockRender.mockRejectedValueOnce(new Error("Offline"));
	const offline = await pageRenderer.render({ ...request, revision: 2 });
	expect(offline.pdfFile).toBe(first.pdfFile);
	expect(offline.stale).toBe(true);
	expect(offline.revision).toBe(1);
});
test("a render completing after account change cannot return old account's PDF", async () => {
	mockScope = "alex";
	mockRender.mockImplementationOnce(async () => {
		mockScope = "other";
		return {
			pdf: new Uint8Array([37, 80, 68, 70]),
			pages: [{ index: 0, uri: "file://source.png", width: 595, height: 842 }],
		};
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
	mockRender.mockRejectedValueOnce(new Error("Offline"));
	await expect(pageRenderer.render({ ...request, revision: "second" })).rejects.toThrow("Offline");
});
