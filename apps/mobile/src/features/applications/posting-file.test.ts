const mockPrivateUpload = jest.fn();
const mockReadBytes = jest.fn();
const mockShare = jest.fn();
const mockAvailable = jest.fn();
const mockPick = jest.fn();
const mockWrite = jest.fn();
const mockDelete = jest.fn();
let mockScope = "owner";
let mockSize = 100;
let mockType = "application/pdf";
jest.mock("expo-crypto", () => ({ randomUUID: () => "unique" }));
jest.mock("expo-document-picker", () => ({ getDocumentAsync: (...args: unknown[]) => mockPick(...args) }));
jest.mock("expo-file-system", () => ({
	Paths: { cache: "file:///cache" },
	Directory: class {
		create() {}
		delete() {
			mockDelete();
		}
	},
	File: class {
		uri = "file:///cache/posting-unique/role.pdf";
		size = mockSize;
		type = mockType;
		write(bytes: unknown) {
			mockWrite(bytes);
		}
	},
}));
jest.mock("expo-sharing", () => ({
	isAvailableAsync: () => mockAvailable(),
	shareAsync: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("@reactive-resume/utils/file", () => ({ sanitizeFileName: (name: string) => name }));
jest.mock("@reactive-resume/utils/http", () => ({ readResponseBytes: (...args: unknown[]) => mockReadBytes(...args) }));
jest.mock("@/api/client", () => ({ privateUpload: (...args: unknown[]) => mockPrivateUpload(...args) }));
jest.mock("@/data/client", () => ({ dataClient: {} }));
jest.mock("@/data/fixtures", () => ({ isFake: () => false }));
jest.mock("@/auth/session", () => ({ getAccountScope: () => mockScope }));
import { openPostingPdf, pickPostingPdf, PostingPdfError } from "./posting-file";

beforeEach(() => {
	jest.clearAllMocks();
	mockScope = "owner";
	mockSize = 100;
	mockType = "application/pdf";
	mockPrivateUpload.mockResolvedValue({ ok: true });
	mockReadBytes.mockResolvedValue(new Uint8Array([1, 2]));
	mockAvailable.mockResolvedValue(true);
	mockShare.mockResolvedValue(undefined);
	mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///picked.pdf" }] });
});
test("rejects oversized and non-PDF picker results with classified validation errors", async () => {
	mockSize = 10 * 1024 * 1024 + 1;
	await expect(pickPostingPdf()).rejects.toBeInstanceOf(PostingPdfError);
	mockSize = 100;
	mockType = "text/plain";
	await expect(pickPostingPdf()).rejects.toBeInstanceOf(PostingPdfError);
	mockPick.mockResolvedValue({ canceled: true });
	expect(await pickPostingPdf()).toBeNull();
});
test("shares authenticated bytes and removes the private cached PDF afterward", async () => {
	await openPostingPdf("/api/uploads/owner/pictures/role.pdf", "role.pdf");
	expect(mockPrivateUpload).toHaveBeenCalledWith(
		"/api/uploads/owner/pictures/role.pdf",
		expect.any(AbortSignal),
		"owner",
	);
	expect(mockWrite).toHaveBeenCalledWith(new Uint8Array([1, 2]));
	expect(mockShare).toHaveBeenCalledWith(expect.stringContaining("role.pdf"), {
		mimeType: "application/pdf",
		UTI: "com.adobe.pdf",
	});
	expect(mockDelete).toHaveBeenCalledTimes(1);
});
test("does not share the previous account's PDF if the account changes while checking sharing", async () => {
	mockAvailable.mockImplementation(async () => {
		mockScope = "other";
		return true;
	});
	await expect(openPostingPdf("/api/uploads/owner/pictures/role.pdf", "role.pdf")).rejects.toThrow();
	expect(mockShare).not.toHaveBeenCalled();
	expect(mockDelete).toHaveBeenCalledTimes(1);
});
test.each(["unavailable", "failed"])("cleans up private cached files when sharing is %s", async (failure) => {
	if (failure === "unavailable") mockAvailable.mockResolvedValue(false);
	else mockShare.mockRejectedValue(new Error("native error"));
	await expect(openPostingPdf("/api/uploads/owner/pictures/role.pdf", "role.pdf")).rejects.toThrow();
	expect(mockDelete).toHaveBeenCalledTimes(1);
});
