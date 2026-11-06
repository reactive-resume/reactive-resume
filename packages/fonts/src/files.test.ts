import { readFile } from "node:fs/promises";
import { expect, it } from "vite-plus/test";
import { isValidFontFile } from "./files";

it("rejects missing tables, truncated data and checksum damage in a real sfnt font", async () => {
	const valid = new Uint8Array(
		await readFile(new URL("../../../apps/web/public/fonts/ibm-plex-serif-400.ttf", import.meta.url)),
	);
	expect(isValidFontFile(valid)).toBe(true);
	expect(isValidFontFile(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
	expect(isValidFontFile(valid.subarray(0, valid.length / 2))).toBe(false);
	const damaged = valid.slice();
	const offset = new DataView(damaged.buffer).getUint32(20);
	damaged[offset] = (damaged[offset] ?? 0) ^ 1;
	expect(isValidFontFile(damaged)).toBe(false);
});
