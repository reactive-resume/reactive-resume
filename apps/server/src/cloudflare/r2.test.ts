import type { R2Bucket } from "@cloudflare/workers-types";
import { expect, it, vi } from "vite-plus/test";
import { R2StorageService } from "./r2";

it("bounds R2 bytes even when object metadata understates their length", async () => {
	const cancel = vi.fn();
	const bucket = {
		get: async () => ({
			size: 0,
			httpEtag: "etag",
			uploaded: new Date(),
			body: new ReadableStream<Uint8Array>(
				{
					pull(controller) {
						controller.enqueue(new Uint8Array([1, 2, 3, 4]));
					},
					cancel,
				},
				{ highWaterMark: 0 },
			),
			arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
		}),
	} as unknown as R2Bucket;
	const storage = new R2StorageService(bucket, "preview");
	await expect(storage.read("uploads/owner/pictures/file.pdf", { maxBytes: 3 })).rejects.toThrow("byte limit");
	expect(cancel).toHaveBeenCalledOnce();
});

it("finishes one pending R2 lookup after cancellation without reading its body", async () => {
	let finish: ((value: unknown) => void) | undefined;
	const get = vi.fn(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const bucket = { get } as unknown as R2Bucket;
	const storage = new R2StorageService(bucket, "preview");
	const controller = new AbortController();
	const pending = storage.read("uploads/owner/pictures/file.pdf", { maxBytes: 3, signal: controller.signal });
	controller.abort();
	expect(get).toHaveBeenCalledOnce();
	const pull = vi.fn();
	const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
	finish?.({ size: 0, httpEtag: "etag", uploaded: new Date(), body });
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	expect(pull).not.toHaveBeenCalled();
	expect(body.locked).toBe(false);
	expect(get).toHaveBeenCalledOnce();
});
