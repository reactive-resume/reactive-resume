import type { HostNode } from "./reconciler";
import { HOST } from "./primitives";

/** A picture ready to embed: its bytes as a data URI and its size in pixels, for `objectFit`. */
export type LoadedImage = { src: string; width: number; height: number };

const MIME_TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;
export const MAX_IMAGE_BYTES = 12_000_000;
export const IMAGE_TIMEOUT_MS = 10_000;

export async function readImageBytes(source: string): Promise<Uint8Array> {
	if (source.startsWith("data:") && source.length > MAX_IMAGE_BYTES * 1.4 + 100) throw new Error("Image exceeds 12 MB");
	const response = await fetch(source, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Image has no body");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 12 MB");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

const u16be = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const u16le = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const u24le = (bytes: Uint8Array, at: number) => u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
const u32be = (bytes: Uint8Array, at: number) => u16be(bytes, at) * 65536 + u16be(bytes, at + 2);
const ascii = (bytes: Uint8Array, at: number, length: number) =>
	String.fromCharCode(...bytes.subarray(at, at + length));

/** Format and pixel size of a PNG, JPEG or WebP, the formats Forme draws; undefined for anything else. */
function readImageHeader(
	bytes: Uint8Array,
): { format: keyof typeof MIME_TYPES; width: number; height: number } | undefined {
	if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG")
		return { format: "png", width: u32be(bytes, 16), height: u32be(bytes, 20) };

	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		// Walk the segments to the first start-of-frame marker, which holds the size.
		let at = 2;
		while (at + 9 < bytes.length) {
			if (bytes[at] !== 0xff) return undefined;
			const marker = bytes[at + 1] ?? 0;
			const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
			if (isFrame) return { format: "jpeg", width: u16be(bytes, at + 7), height: u16be(bytes, at + 5) };
			at += 2 + u16be(bytes, at + 2);
		}
		return undefined;
	}

	if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
		const chunk = ascii(bytes, 12, 4);
		if (chunk === "VP8 ")
			return { format: "webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
		if (chunk === "VP8L") {
			const bits = (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24);
			return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
		}
		if (chunk === "VP8X") return { format: "webp", width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
	}
	return undefined;
}

export const toBase64 = (bytes: Uint8Array) => {
	let binary = "";
	for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(binary);
};

/** Every picture source in the rendered tree. */
export function imageSources(tree: HostNode[]): string[] {
	const sources = new Set<string>();
	const visit = (node: HostNode) => {
		if ("text" in node) return;
		if (node.type === HOST.image) {
			const { src } = node.props;
			if (typeof src === "string" && src.length > 0) sources.add(src);
		}
		node.children.forEach(visit);
	};
	tree.forEach(visit);
	return [...sources];
}

/**
 * Downloads the pictures once, before layout. Forme would fetch them itself, but a failed download there fails the
 * whole document; here the picture is left out with a warning, as react-pdf did.
 */
export async function loadImages(sources: readonly string[], read = readImageBytes) {
	const images = new Map<string, LoadedImage>();
	const warnings: string[] = [];
	await Promise.all(
		sources.map(async (source) => {
			try {
				const bytes = await read(source);
				const header = readImageHeader(bytes);
				if (!header) throw new Error("not a PNG, JPEG or WebP image");
				if (
					bytes.length > MAX_IMAGE_BYTES ||
					header.width < 1 ||
					header.height < 1 ||
					header.width * header.height > 25_000_000
				)
					throw new Error("Image exceeds size limit");
				images.set(source, {
					src: `data:${MIME_TYPES[header.format]};base64,${toBase64(bytes)}`,
					width: header.width,
					height: header.height,
				});
			} catch (error) {
				warnings.push(`Picture ${source.slice(0, 80)}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
	);
	return { images, warnings };
}
