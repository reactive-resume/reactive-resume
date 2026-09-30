import type { PdfFontRequest } from "../hooks/use-register-fonts";
import type { FormeFont } from "@formepdf/react";
import { prepareFontBytes } from "./font-bytes";

// One download per font file for the life of the page or server process.
const cache = new Map<string, Promise<Uint8Array>>();

const load = (src: string) => {
	let bytes = cache.get(src);
	if (!bytes) {
		bytes = fetch(src)
			.then((response) => {
				if (!response.ok) throw new Error(`Font ${src}: HTTP ${response.status}`);
				return response.arrayBuffer();
			})
			.then((buffer) => prepareFontBytes(new Uint8Array(buffer)));
		// A failed download may succeed next time.
		bytes.catch(() => cache.delete(src));
		cache.set(src, bytes);
	}
	return bytes;
};

/**
 * The font faces a document needs, as bytes Forme can embed. A face that fails to load is left out and listed in
 * `missing`; Forme falls back to its built-in fonts for that text.
 */
export async function loadFonts(
	requests: readonly PdfFontRequest[],
): Promise<{ fonts: FormeFont[]; warnings: string[]; missing: string[] }> {
	const warnings: string[] = [];
	const missing: string[] = [];
	const loaded = await Promise.all(
		requests.map(async (request): Promise<FormeFont | null> => {
			try {
				return { family: request.family, weight: request.weight, italic: request.italic, src: await load(request.src) };
			} catch (error) {
				warnings.push(error instanceof Error ? error.message : `Font ${request.src} could not be loaded.`);
				missing.push(request.family);
				return null;
			}
		}),
	);
	return { fonts: loaded.filter((font): font is FormeFont => font !== null), warnings, missing };
}
