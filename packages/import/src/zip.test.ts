import { describe, expect, it } from "vite-plus/test";
import { Zip, ZipDeflate, strToU8, zipSync } from "fflate";
import { ZipEntryTooLargeError, unzipEntries } from "./zip";

const streamed = (files: Record<string, Uint8Array>) => {
	// Streamed archives store sizes in data descriptors after each entry, as many exporters do.
	const chunks: Uint8Array[] = [];
	const zip = new Zip((error, chunk) => {
		if (error) throw error;
		chunks.push(chunk);
	});
	for (const [name, data] of Object.entries(files)) {
		const entry = new ZipDeflate(name);
		zip.add(entry);
		entry.push(data, true);
	}
	zip.end();
	return new Uint8Array(Buffer.concat(chunks));
};

describe("unzipEntries", () => {
	it("caps headers even when every archive entry is rejected", () => {
		const files = Object.fromEntries(
			Array.from({ length: 2_001 }, (_, index) => [`ignored-${index}`, new Uint8Array()]),
		);
		expect(() => unzipEntries(zipSync(files), () => false, 1024)).toThrow("ZIP contains too many entries");
	});

	it.each([
		["central-directory sizes", zipSync],
		["data descriptors", streamed],
	])("reads only the first selected entry of each name (%s)", (_, build) => {
		const archive = build({
			"a/Profile.csv": strToU8("first"),
			"b/Profile.csv": strToU8("second"),
			"media/video.bin": new Uint8Array(1024),
		});
		const seen = new Set<string>();
		const files = unzipEntries(
			archive,
			(name) => {
				const base = name.split("/").pop() ?? name;
				if (base !== "Profile.csv" || seen.has(base)) return false;
				return (seen.add(base), true);
			},
			1024,
		);
		expect(Object.keys(files)).toEqual(["a/Profile.csv"]);
		expect(new TextDecoder().decode(files["a/Profile.csv"])).toBe("first");
	});

	it("stops at the bytes an entry actually produces, whatever the archive declares", () => {
		const archive = zipSync({ "word/document.xml": new Uint8Array(4 * 1024 * 1024) });
		// Claim the entry inflates to 16 bytes, in both the local header and the central directory.
		const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
		for (let offset = 0; offset < archive.length - 4; offset++) {
			const signature = view.getUint32(offset, true);
			if (signature === 0x04034b50) view.setUint32(offset + 22, 16, true);
			if (signature === 0x02014b50) view.setUint32(offset + 24, 16, true);
		}
		expect(() => unzipEntries(archive, (name) => name === "word/document.xml", 64 * 1024)).toThrow(
			ZipEntryTooLargeError,
		);
	});
});
