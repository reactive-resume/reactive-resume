import { expect, it, vi } from "vite-plus/test";
import { readStorageBody, StorageReadLimitError } from "./read";

it.each([undefined, 1, 100])(
	"bounds actual storage bytes and cancels without draining (declared: %s)",
	async (declared) => {
		const cancel = vi.fn();
		const chunks = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5])];
		const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
			const chunk = chunks.shift();
			if (chunk) controller.enqueue(chunk);
			else controller.close();
		});
		const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
		await expect(readStorageBody(body, { maxBytes: 3 }, declared)).rejects.toBeInstanceOf(StorageReadLimitError);
		expect(pull).toHaveBeenCalledTimes(declared === 100 ? 0 : 1);
		expect(cancel).toHaveBeenCalledOnce();
	},
);

it("retains bytes at the limit rather than trusting an understated length", async () => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array([0, 255]));
			controller.enqueue(new Uint8Array([42]));
			controller.close();
		},
	});
	expect(await readStorageBody(body, { maxBytes: 3 }, 0)).toEqual(new Uint8Array([0, 255, 42]));
});

it("aborts a pending storage read and releases its reader", async () => {
	const cancel = vi.fn();
	const controller = new AbortController();
	const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
	const pending = readStorageBody(body, { maxBytes: 3, signal: controller.signal });
	controller.abort();
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	expect(cancel).toHaveBeenCalledOnce();
	expect(body.locked).toBe(false);
});
