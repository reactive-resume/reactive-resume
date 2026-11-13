import { expect, it, vi } from "vite-plus/test";
import { accountBackupLimits } from "@reactive-resume/utils/account-zip";

const read = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/env/server", () => ({ env: { APP_URL: "http://localhost:3000" } }));
vi.mock("../storage/service", () => ({ getStorageService: () => ({ read }) }));
import { exportAccountUploads } from "./export-uploads";

it("never fetches external photos or unsafe references, and records each exclusion", async () => {
	read.mockClear();
	const data = {
		career: { threads: [], attachments: [] },
		user: { image: "https://photos.example.test/avatar.jpg" },
		resume: { picture: { url: "uploads/owner/../foreign/photo.png" } },
		copiedReference: "http://localhost:3000/api/uploads/neighbor/pictures/file.png",
	};
	const result = await exportAccountUploads("owner", data);
	expect(read).not.toHaveBeenCalled();
	expect(result.files).toEqual([]);
	expect(result.skipped).toEqual(
		expect.arrayContaining([
			{ key: "https://photos.example.test/avatar.jpg", reason: "external-reference" },
			{ key: "uploads/owner/../foreign/photo.png", reason: "outside-account" },
			{ key: "uploads/neighbor/pictures/file.png", reason: "outside-account" },
		]),
	);
});

it("exports the original posting PDF kept with an application", async () => {
	read.mockReset().mockResolvedValue({ data: new Uint8Array([1]), size: 1 });
	const data = {
		career: { threads: [], attachments: [] },
		applications: [{ id: "app-1", postingFileUrl: "http://localhost:3000/api/uploads/owner/pictures/posting.pdf" }],
	};
	const result = await exportAccountUploads("owner", data);
	expect(read).toHaveBeenCalledWith("uploads/owner/pictures/posting.pdf", expect.anything());
	expect(result.files.map((file) => file.key)).toEqual(["uploads/owner/pictures/posting.pdf"]);
});

it("caps attempted file reads even when every referenced file is unavailable", async () => {
	read.mockReset().mockResolvedValue(null);
	const references = Array.from(
		{ length: accountBackupLimits.files + 1 },
		(_, index) => `uploads/owner/pictures/${index}.png`,
	);
	const data = { career: { threads: [], attachments: [] }, references };
	const result = await exportAccountUploads("owner", data);
	expect(read).toHaveBeenCalledTimes(accountBackupLimits.files);
	expect(result.files).toEqual([]);
	expect(result.skipped).toHaveLength(references.length);
	expect(result.skipped.at(-1)).toEqual({ key: references.at(-1), reason: "count-limit" });
});
