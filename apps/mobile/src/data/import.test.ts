const mockFiles = new Map<string, string>();
const mockImport = jest.fn(async (..._args: unknown[]) => "imported-resume");
const mockParse = jest.fn();
const mockApproved = jest.fn(async (..._args: unknown[]) => false);
jest.mock("./client", () => ({ dataClient: { resume: { import: (...args: unknown[]) => mockImport(...args) } } }));
jest.mock("./scope", () => ({ activeDataScope: () => "account", assertDataScope: jest.fn() }));
jest.mock("./fixtures", () => ({ isFake: () => false }));
jest.mock("./backup", () => ({
	isQueueBundle: (value: { format?: string }) => value?.format === "reactive-resume-queued-changes",
	restoreQueued: jest.fn(),
}));
jest.mock("./consent", () => ({ ensureApproved: (...args: unknown[]) => mockApproved(...args) }));
jest.mock("@/api/client", () => ({
	rest: jest.fn(),
	client: { ai: { parseDocx: (...args: unknown[]) => mockParse(...args) } },
}));
jest.mock("expo-file-system", () => ({
	File: class {
		uri: string;
		constructor(value: string) {
			this.uri = value;
		}
		get size() {
			return mockFiles.get(this.uri)?.length ?? 1;
		}
		async text() {
			return mockFiles.get(this.uri) ?? "";
		}
		async base64() {
			return "ZmlsZQ==";
		}
	},
}));
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	readImportFile,
	createImportedResume,
	parseResumeFileJSON,
	DocumentImportError,
	type ImportStep,
} from "./import";
test("JSON review precedes creation; language and source file survive", async () => {
	const file = { uri: "file://resume", name: "resume.json", lastModified: 0 };
	mockFiles.set(file.uri, JSON.stringify({ data: defaultResumeData }));
	const steps: ImportStep[] = [];
	const options = { signal: new AbortController().signal, onStep: (value: ImportStep) => steps.push(value) };
	const preview = await readImportFile(file, options);
	expect(preview.kind).toBe("resume");
	expect(preview.file).toBe(file);
	expect(mockImport).not.toHaveBeenCalled();
	expect(steps).toEqual(["reading", "parsing", "review"]);
	await expect(createImportedResume(preview, options)).resolves.toEqual({ type: "resume", id: "imported-resume" });
	expect(steps).toEqual(["reading", "parsing", "review", "creating", "complete"]);
	expect(parseResumeFileJSON({ data: defaultResumeData }).metadata.page.locale).toBe(
		defaultResumeData.metadata.page.locale,
	);
});
test("file consent rejection prevents AI parse and retains source", async () => {
	const file = { uri: "file://word", name: "resume.docx", lastModified: 0 };
	try {
		await readImportFile(file, {
			signal: new AbortController().signal,
			connection: { id: "provider", provider: "openai", host: "https://api.openai.com", keyFingerprint: "fingerprint" },
		});
		throw new Error("Expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(DocumentImportError);
		expect((error as DocumentImportError).code).toBe("consent");
		expect((error as DocumentImportError).file).toBe(file);
	}
	expect(mockApproved).toHaveBeenCalledWith("file", expect.objectContaining({ id: "provider" }));
	expect(mockParse).not.toHaveBeenCalled();
});
test("S8 bundle remains a restore review, not a resume creation", async () => {
	const file = { uri: "file://backup", name: "backup.json", lastModified: 0 };
	mockFiles.set(file.uri, JSON.stringify({ format: "reactive-resume-queued-changes", version: 1 }));
	expect((await readImportFile(file, { signal: new AbortController().signal })).kind).toBe("backup");
});
