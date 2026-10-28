import { Unzlib } from "fflate";

const WOFF = 0x774f4646; // "wOFF"

/** WOFF 1.0 → sfnt: inflate each table and lay them out after a fresh table directory. */
function woffToSfnt(bytes: Uint8Array): Uint8Array {
	if (bytes.length < 44) throw new Error("Invalid WOFF header.");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const flavor = view.getUint32(4);
	const numTables = view.getUint16(12);
	const directoryEnd = 44 + numTables * 20;
	if (!numTables || numTables > 256 || directoryEnd > bytes.length || view.getUint32(8) !== bytes.length)
		throw new Error("Invalid WOFF table directory.");
	const headerLength = 12 + numTables * 16;
	const padded = (length: number) => Math.ceil(length / 4) * 4;
	let total = headerLength;

	const tables: { tag: number; checksum: number; offset: number; compLength: number; origLength: number }[] = [];
	const tags = new Set<number>();
	for (let index = 0; index < numTables; index++) {
		const entry = 44 + index * 20;
		const tag = view.getUint32(entry);
		const offset = view.getUint32(entry + 4);
		const compLength = view.getUint32(entry + 8);
		const origLength = view.getUint32(entry + 12);
		const checksum = view.getUint32(entry + 16);
		total += padded(origLength);
		if (
			tags.has(tag) ||
			offset < directoryEnd ||
			offset % 4 !== 0 ||
			offset + compLength > bytes.length ||
			compLength > origLength ||
			total > 32 * 1024 * 1024
		)
			throw new Error("Invalid or oversized WOFF table.");
		tags.add(tag);
		tables.push({ tag, checksum, offset, compLength, origLength });
	}
	if (total !== view.getUint32(16)) throw new Error("Invalid WOFF expanded size.");
	let previousEnd = directoryEnd;
	for (const table of [...tables].sort((a, b) => a.offset - b.offset)) {
		if (table.offset < previousEnd) throw new Error("Overlapping WOFF tables.");
		previousEnd = table.offset + table.compLength;
	}
	const out = new Uint8Array(total);
	const outView = new DataView(out.buffer);

	let searchRange = 1;
	let entrySelector = 0;
	while (searchRange * 2 <= numTables) {
		searchRange *= 2;
		entrySelector++;
	}
	outView.setUint32(0, flavor);
	outView.setUint16(4, numTables);
	outView.setUint16(6, searchRange * 16);
	outView.setUint16(8, entrySelector);
	outView.setUint16(10, numTables * 16 - searchRange * 16);

	let dataOffset = headerLength;
	tables.forEach((table, index) => {
		const record = 12 + index * 16;
		outView.setUint32(record, table.tag);
		outView.setUint32(record + 4, table.checksum);
		outView.setUint32(record + 8, dataOffset);
		outView.setUint32(record + 12, table.origLength);
		const stored = bytes.subarray(table.offset, table.offset + table.compLength);
		if (table.compLength === table.origLength) out.set(stored, dataOffset);
		else {
			let written = 0;
			const inflater = new Unzlib((chunk) => {
				if (written + chunk.length > table.origLength) throw new Error("WOFF table exceeds its declared size.");
				out.set(chunk, dataOffset + written);
				written += chunk.length;
			});
			// Small compressed chunks bound temporary output even when the declared size is dishonest.
			for (let offset = 0; offset < stored.length; offset += 256)
				inflater.push(stored.subarray(offset, offset + 256), offset + 256 >= stored.length);
			if (written !== table.origLength) throw new Error("Invalid WOFF table size.");
		}
		dataOffset += padded(table.origLength);
	});
	return out;
}

/** WOFF 1.0 becomes sfnt; other supported formats pass through unchanged. */
export function prepareFontBytes(bytes: Uint8Array): Uint8Array {
	if (bytes.byteLength < 12) return bytes;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return view.getUint32(0) === WOFF ? woffToSfnt(bytes) : bytes;
}
