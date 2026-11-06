import type { FontReadOptions } from "@reactive-resume/pdf/native";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { isValidFontFile } from "@reactive-resume/fonts/files";
import { configureFontReader, configureImageFetch, downloadFont } from "@reactive-resume/pdf/native";
import { createSerialQueue } from "@reactive-resume/utils/queue";
import { getServer } from "@/auth/session";

const MAX_IMAGE_BYTES = 12_000_000;
const MAX_FONT_CACHE_BYTES = 200_000_000;
let configured = false;
const inFontCache = createSerialQueue();

/** FIFO by last write, including interrupted writes. Called only inside the serialized disk queue. */
function trimFonts(directory: Directory, incoming: number) {
	const files = directory.list().filter((entry): entry is File => entry instanceof File);
	for (const file of files.filter((entry) => entry.name.endsWith(".tmp"))) file.delete();
	const fonts = files.filter((entry) => !entry.name.endsWith(".tmp"));
	let total = fonts.reduce((sum, file) => sum + file.size, 0);
	for (const file of fonts.sort((left, right) => (left.lastModified ?? 0) - (right.lastModified ?? 0))) {
		if (total + incoming <= MAX_FONT_CACHE_BYTES) break;
		const size = file.size;
		file.delete();
		total -= size;
	}
}

/** Disk failures never prevent a network font download. Store raw bytes; pdf owns WOFF conversion. */
export async function readCachedFont(source: string, options: FontReadOptions = {}): Promise<Uint8Array> {
	const directory = new Directory(Paths.cache, "pdf-fonts-v1");
	let file: File | undefined;
	try {
		file = new File(
			directory,
			await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${options.mirror ? "mirror:" : ""}${source}`),
		);
		const target = file;
		const cached = await inFontCache(async () => {
			directory.create({ intermediates: true, idempotent: true });
			trimFonts(directory, 0);
			if (!target.exists) return null;
			const bytes = await target.bytes();
			if (isValidFontFile(bytes)) return bytes;
			target.delete();
			return null;
		});
		if (cached) return cached;
	} catch {
		file = undefined;
	}
	const bytes = await downloadFont(source, expoFetch as unknown as typeof fetch, options);
	if (!isValidFontFile(bytes)) throw new Error("Invalid font data");
	if (file && bytes.length <= MAX_FONT_CACHE_BYTES) {
		const target = file;
		await inFontCache(async () => {
			const temporary = new File(`${target.uri}.tmp`);
			try {
				directory.create({ intermediates: true, idempotent: true });
				trimFonts(directory, bytes.length);
				await temporary.write(bytes);
				await temporary.move(target, { overwrite: true });
			} finally {
				if (temporary.uri !== target.uri && temporary.exists) temporary.delete();
			}
		}).catch(() => undefined); // Disk errors keep the validated network bytes usable in memory.
	}
	return bytes;
}

export function configurePreviewResources() {
	if (configured) return;
	configured = true;
	try {
		const legacy = new Directory(Paths.document, "pdf-fonts-v1");
		if (legacy.exists) legacy.delete();
	} catch {
		/* Removing the former backed-up cache is best effort. New files only use Paths.cache. */
	}
	configureFontReader(readCachedFont);
	configureImageFetch(expoFetch as unknown as typeof fetch);
}

/** Android expo/fetch cannot be relied on for data: URLs. Decode locally, then enforce the same byte limit. */
export async function readPreviewImage(source: string, server = getServer()): Promise<Uint8Array> {
	if (source.startsWith("data:")) {
		const comma = source.indexOf(",");
		if (comma < 0) throw new Error("Invalid image data URI");
		const header = source.slice(0, comma);
		const payload = source.slice(comma + 1);
		const base64 = /;base64$/i.test(header);
		if (payload.length > MAX_IMAGE_BYTES * (base64 ? 1.4 : 3) + 100) throw new Error("Image exceeds 12 MB");
		const binary = base64
			? atob(decodeURIComponent(payload))
			: payload.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
		if (binary.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 12 MB");
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	}
	const url = new URL(source, server);
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported image URL");
	const response = await expoFetch(url.href, { signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`Image HTTP ${response.status}`);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Image has no streaming body");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 12 MB");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
