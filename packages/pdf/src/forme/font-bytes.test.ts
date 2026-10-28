import { describe, expect, it } from "vite-plus/test";
import { zlibSync } from "fflate";
import { prepareFontBytes } from "./font-bytes";

function woff(data: Uint8Array, declared = data.length, count = 1) {
	const compressed = zlibSync(data);
	const offset = Math.ceil((44 + count * 20) / 4) * 4;
	const bytes = new Uint8Array(offset + compressed.length);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x774f4646);
	view.setUint32(4, 0x00010000);
	view.setUint32(8, bytes.length);
	view.setUint16(12, count);
	view.setUint32(16, 12 + count * (16 + Math.ceil(declared / 4) * 4));
	for (let i = 0; i < count; i++) {
		const entry = 44 + i * 20;
		view.setUint32(entry, 0x74657374 + i);
		view.setUint32(entry + 4, offset);
		view.setUint32(entry + 8, compressed.length);
		view.setUint32(entry + 12, declared);
	}
	bytes.set(compressed, offset);
	return bytes;
}

describe("WOFF decompression budget", () => {
	it("decodes a valid compressed table", () => {
		const data = new Uint8Array(4096).fill(42);
		expect(prepareFontBytes(woff(data)).subarray(28)).toEqual(data);
	});
	it("rejects overlapping table ranges before inflating", () => {
		expect(() => prepareFontBytes(woff(new Uint8Array(4096), 4096, 2))).toThrow("Overlapping");
	});
	it("rejects a dishonest expanded size and an oversized declared output", () => {
		expect(() => prepareFontBytes(woff(new Uint8Array(4096), 512))).toThrow("declared size");
		expect(() => prepareFontBytes(woff(new Uint8Array(4096), 40 * 1024 * 1024))).toThrow("oversized");
	});
});
