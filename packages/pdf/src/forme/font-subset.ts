import { toBase64 } from "./images";

/** The harfbuzz exports `createFontSubsetter` calls (harfbuzzjs's `harfbuzz-subset.wasm`). */
type HarfBuzz = {
	memory: WebAssembly.Memory;
	_initialize: () => void;
	malloc: (size: number) => number;
	free: (pointer: number) => void;
	hb_blob_create: (data: number, length: number, mode: number, userData: number, destroy: number) => number;
	hb_blob_destroy: (blob: number) => void;
	hb_blob_get_data: (blob: number, length: number) => number;
	hb_blob_get_length: (blob: number) => number;
	hb_face_create: (blob: number, index: number) => number;
	hb_face_destroy: (face: number) => void;
	hb_face_reference_blob: (face: number) => number;
	hb_set_add: (set: number, value: number) => void;
	hb_set_clear: (set: number) => void;
	hb_set_invert: (set: number) => void;
	hb_subset_input_create_or_fail: () => number;
	hb_subset_input_destroy: (input: number) => void;
	hb_subset_input_set: (input: number, kind: number) => number;
	hb_subset_input_unicode_set: (input: number) => number;
	hb_subset_or_fail: (face: number, input: number) => number;
};

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

/** Returns `font` (TrueType or OpenType bytes) with only the glyphs `text` needs. */
export type FontSubsetter = (font: Uint8Array, text: string) => Uint8Array;

/**
 * Cuts fonts down to the characters a document draws, with harfbuzz's subsetter. Forme takes every font as base64 in
 * the JSON of each render, so whole CJK faces (10–15 MB each) made every render of a CJK resume take seconds (#3593).
 */
export async function createFontSubsetter(wasm: BufferSource): Promise<FontSubsetter> {
	const { instance } = await WebAssembly.instantiate(wasm);
	const hb = instance.exports as unknown as HarfBuzz;
	hb._initialize();

	return (font, text) => {
		const input = hb.hb_subset_input_create_or_fail();
		if (!input) throw new Error("harfbuzz couldn't start a subset");
		const fontPointer = hb.malloc(font.byteLength);
		new Uint8Array(hb.memory.buffer).set(font, fontPointer);
		const blob = hb.hb_blob_create(fontPointer, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
		const face = hb.hb_face_create(blob, 0);
		hb.hb_blob_destroy(blob);
		try {
			// Every layout feature stays (`hb-subset --layout-features=*`): ligatures, kerning and script shaping.
			const features = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
			hb.hb_set_clear(features);
			hb.hb_set_invert(features);
			const unicodes = hb.hb_subset_input_unicode_set(input);
			for (const character of text) hb.hb_set_add(unicodes, character.codePointAt(0) ?? 0);

			const subset = hb.hb_subset_or_fail(face, input);
			if (!subset) throw new Error("harfbuzz couldn't subset the font");
			const result = hb.hb_face_reference_blob(subset);
			try {
				const length = hb.hb_blob_get_length(result);
				if (!length) throw new Error("harfbuzz returned an empty font");
				// Copied out: the next call can grow the memory and detach this view.
				return new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(result, 0), length).slice();
			} finally {
				hb.hb_blob_destroy(result);
				hb.hb_face_destroy(subset);
			}
		} finally {
			hb.hb_subset_input_destroy(input);
			hb.hb_face_destroy(face);
			hb.free(fontPointer);
		}
	};
}

// Characters Forme can draw that a document's text needn't contain: digits, hyphens at breaks, its "?" and "…".
const ALWAYS_KEPT = `${Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("")}\u00a0\u00ad\u2010\u2011\u2026`;

/**
 * Turns a font's bytes into what Forme gets, a data URI it passes through as is: cut to the document's characters
 * when there's a subsetter, encoded once. Per font file, the last result is kept, so an edit that adds no character
 * reuses it. Without a subsetter (it couldn't load), whole fonts still render, only slower.
 */
export function createFontPreparer(subsetFont: FontSubsetter | null) {
	const prepared = new WeakMap<Uint8Array, { text: string; src: string }>();
	return (bytes: Uint8Array, text: string): string => {
		const cached = prepared.get(bytes);
		if (cached?.text === text) return cached.src;
		let font = bytes;
		try {
			if (subsetFont) font = subsetFont(bytes, text + ALWAYS_KEPT);
		} catch {
			// A font harfbuzz can't cut is embedded whole.
		}
		const src = `data:font/ttf;base64,${toBase64(font)}`;
		prepared.set(bytes, { text, src });
		return src;
	};
}
