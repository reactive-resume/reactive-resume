// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { clearStoredThumbnails, readStoredThumbnail, storeThumbnail } from "./thumbnail-store";

beforeEach(() => {
	const entries = new Map<string, Response>();
	const cache = {
		match: async (key: string) => entries.get(key)?.clone(),
		put: async (key: string, response: Response) => void entries.set(key, response),
		keys: async () => [...entries.keys()],
		delete: async (key: string) => entries.delete(key),
	};
	vi.stubGlobal("caches", { open: async () => cache, delete: async () => (entries.clear(), true) });
});

afterEach(() => vi.unstubAllGlobals());

const updatedAt = new Date("2026-10-01T10:00:00Z");
const size = { width: 448, height: 640 };
const build = "build-1";

it("reuses a stored thumbnail only for the same edit and renderer at no larger a size", async () => {
	await storeThumbnail("resume-1", { updatedAt, size, build }, new Blob(["png"], { type: "image/png" }));

	expect(await readStoredThumbnail("resume-1", { updatedAt, size: { width: 384, height: 576 }, build })).toBeDefined();
	expect(
		await readStoredThumbnail("resume-1", { updatedAt, size: { width: 512, height: 704 }, build }),
	).toBeUndefined();
	expect(
		await readStoredThumbnail("resume-1", { updatedAt: new Date("2026-10-02T10:00:00Z"), size, build }),
	).toBeUndefined();
	expect(await readStoredThumbnail("resume-1", { updatedAt, size, build: "build-2" })).toBeUndefined();
	expect(await readStoredThumbnail("resume-2", { updatedAt, size, build })).toBeUndefined();
});

it("forgets every thumbnail on sign-out", async () => {
	await storeThumbnail("resume-1", { updatedAt, size, build }, new Blob(["png"]));
	await clearStoredThumbnails();
	expect(await readStoredThumbnail("resume-1", { updatedAt, size, build })).toBeUndefined();
});

it("falls back to rendering when Cache Storage is unavailable", async () => {
	vi.stubGlobal("caches", undefined);
	await expect(storeThumbnail("resume-1", { updatedAt, size, build }, new Blob(["png"]))).resolves.toBeUndefined();
	expect(await readStoredThumbnail("resume-1", { updatedAt, size, build })).toBeUndefined();
});
