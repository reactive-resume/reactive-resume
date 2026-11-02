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
