export type StorageReadOptions = { maxBytes: number; signal?: AbortSignal | undefined };

export class StorageReadLimitError extends Error {
	constructor() {
		super("Storage file exceeds the requested byte limit.");
	}
}

/** Bound the actual body, including when storage omits or understates its length. */
export async function readStorageBody(
	body: ReadableStream<Uint8Array> | NodeReadableStream<Uint8Array>,
	options: StorageReadOptions,
	declaredSize?: number,
): Promise<Uint8Array> {
	const reader = body.getReader();
	const cancel = () => void reader.cancel(options.signal?.reason).catch(() => {});
	options.signal?.addEventListener("abort", cancel, { once: true });
	try {
		options.signal?.throwIfAborted();
		if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) throw new RangeError("Invalid byte limit");
		if (declaredSize !== undefined && declaredSize > options.maxBytes) throw new StorageReadLimitError();
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			options.signal?.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > options.maxBytes) throw new StorageReadLimitError();
			chunks.push(value);
		}
		const data = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			data.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return data;
	} finally {
		options.signal?.removeEventListener("abort", cancel);
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
