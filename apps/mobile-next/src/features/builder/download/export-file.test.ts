jest.mock("@reactive-resume/utils/file", () => ({ sanitizeFileName: (value: string) => value }));
jest.mock("uuid", () => ({ validate: () => false, v5: () => "test", v7: () => "test" }));
jest.mock("@/render/page-renderer", () => ({ pageRenderer: { render: jest.fn() } }));
jest.mock("expo-file-system", () => ({
	Directory: { pickDirectoryAsync: jest.fn() },
	File: jest.fn(),
	Paths: { cache: "file:///cache" },
}));
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn() }));
import { Directory, type File } from "expo-file-system";
import { deliverExports } from "./export-file";

test("two-file export picks one folder and writes both files", async () => {
	const createFile = jest.fn((name: string) => ({ uri: `file:///selected/${name}` }));
	jest.mocked(Directory.pickDirectoryAsync).mockResolvedValue({ createFile } as unknown as Directory);
	const resume = { name: "Resume.pdf", type: "application/pdf", copy: jest.fn() } as unknown as File;
	const letter = { name: "Letter.pdf", type: "application/pdf", copy: jest.fn() } as unknown as File;
	await deliverExports([resume, letter], true);
	expect(Directory.pickDirectoryAsync).toHaveBeenCalledTimes(1);
	expect(resume.copy).toHaveBeenCalledWith({ uri: "file:///selected/Resume.pdf" });
	expect(letter.copy).toHaveBeenCalledWith({ uri: "file:///selected/Letter.pdf" });
});
test("a cancelled folder picker never claims or writes a saved file", async () => {
	jest.mocked(Directory.pickDirectoryAsync).mockRejectedValue(new Error("cancelled"));
	const copy = jest.fn();
	await expect(
		deliverExports([{ name: "Resume.pdf", type: "application/pdf", copy } as unknown as File], true),
	).rejects.toThrow("cancelled");
	expect(copy).not.toHaveBeenCalled();
});
