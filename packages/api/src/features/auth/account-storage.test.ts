import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { getStorageService } from "../storage/service";
import { authService } from "./service";

const settings = vi.hoisted(() => ({ STORAGE_BACKEND: "local", LOCAL_STORAGE_PATH: "" }));
const deleteUser = vi.hoisted(() => vi.fn(() => ({ where: async () => undefined })));
vi.mock("@reactive-resume/env/server", () => ({ env: settings }));
vi.mock("@reactive-resume/db/client", () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => [] }) }),
		delete: deleteUser,
	},
}));
vi.mock("@reactive-resume/auth/config", () => ({ auth: { $context: { secretConfig: "fixture" } } }));
vi.mock("../applications/lanes", () => ({ applicationLaneService: {} }));
vi.mock("../career/service", () => ({ careerService: {} }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));

afterEach(async () => {
	if (settings.LOCAL_STORAGE_PATH) await rm(settings.LOCAL_STORAGE_PATH, { recursive: true, force: true });
});

it("account deletion erases retained photo uploads, including unreferenced photos, without touching another account", async () => {
	settings.LOCAL_STORAGE_PATH = await mkdtemp(join(tmpdir(), "resume-account-storage-"));
	const storage = getStorageService();
	const owned = [
		"uploads/owner/pictures/shared.jpeg",
		"uploads/owner/pictures/removed.jpeg",
		"uploads/owner/screenshots/resume.webp",
		"uploads/owner/pdfs/resume.pdf",
	];
	const neighbor = "uploads/owner-other/pictures/photo.jpeg";
	for (const key of [...owned, neighbor]) {
		await storage.write({ key, data: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
	}

	await authService.deleteAccount({ userId: "owner" });

	for (const key of owned) expect(await storage.read(key)).toBeNull();
	expect((await storage.read(neighbor))?.data).toEqual(Buffer.from([1, 2, 3]));
	expect(deleteUser).toHaveBeenCalledOnce();
});
