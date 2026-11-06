import type { PdfFontRequest } from "../hooks/use-register-fonts";
import type { FormeFont } from "@formepdf/react";
import { isValidFontFile, prepareFontBytes } from "@reactive-resume/fonts/files";
import { resolveFontSource } from "@reactive-resume/fonts/sources";

// One download per font file for the life of the page or server process.
const cache = new Map<string, Promise<Uint8Array>>();
// A download that stops sending fails the render instead of holding the preview on its loader. One that is slow but
// still sending finishes: CJK faces are 10–15 MB, and a resume can need five at once (#3627).
const STALL_TIMEOUT_MS = 30_000;

// Google serves the same files from fonts.gstatic.cn, which loads where fonts.gstatic.com is blocked or slow
// (mainland China). Each download starts on the host that last answered; when that host fails, or sends nothing
// within FALLBACK_AFTER_MS, the other host starts too and the first to answer wins.
const GSTATIC_HOSTS = ["fonts.gstatic.com", "fonts.gstatic.cn"];
const FALLBACK_AFTER_MS = 3000;
// The largest catalog face is about 15 MB; a host that keeps streaming past this is refused, not buffered.
const MAX_FONT_BYTES = 32 * 1024 * 1024;
let preferredHost = GSTATIC_HOSTS[0] ?? "";

export type FontReadOptions = { mirror?: boolean | undefined };

function fetchFont(
	src: string,
	signal: AbortSignal,
	fetcher: typeof fetch,
	options: FontReadOptions,
): Promise<Response> {
	const url = new URL(src);
	const check = (response: Response) => {
		if (!response.ok) throw new Error(`Font ${src}: HTTP ${response.status}`);
		return response;
	};
	// Redirects and the gstatic race must never escape an operator's explicit mirror.
	if (options.mirror) return fetcher(src, { signal, redirect: "error" }).then(check);
	if (!GSTATIC_HOSTS.includes(url.hostname)) return fetcher(src, { signal }).then(check);

	const hosts = [preferredHost, ...GSTATIC_HOSTS.filter((host) => host !== preferredHost)];
	const attempts = hosts.map(() => new AbortController());
	signal.addEventListener("abort", () => attempts.forEach((attempt) => attempt.abort(signal.reason)), { once: true });

	return new Promise((resolve, reject) => {
		let started = 0;
		let failed = 0;
		let settled = false;
		const start = (index: number) => {
			const host = hosts[index];
			const attempt = attempts[index];
			if (settled || index < started || !host || !attempt) return;
			started = index + 1;
			const fallback = setTimeout(() => start(index + 1), FALLBACK_AFTER_MS);
			const target = new URL(url);
			target.hostname = host;
			fetcher(target, { signal: attempt.signal })
				.then(check)
				.then((response) => {
					clearTimeout(fallback);
					if (settled) return;
					settled = true;
					preferredHost = host;
					attempts.forEach((other) => other !== attempt && other.abort());
					resolve(response);
				})
				.catch((error: unknown) => {
					clearTimeout(fallback);
					failed += 1;
					if (settled) return;
					if (failed === hosts.length) {
						settled = true;
						reject(error);
					} else start(index + 1);
				});
		};
		start(0);
	});
}

/** Downloads a font file's bytes from its source, trying the gstatic mirror when Google's host fails. */
export async function downloadFont(
	src: string,
	fetcher: typeof fetch = fetch,
	options: FontReadOptions = {},
): Promise<Uint8Array> {
	const controller = new AbortController();
	let stall: ReturnType<typeof setTimeout> | undefined;
	const progress = () => {
		clearTimeout(stall);
		stall = setTimeout(() => controller.abort(new Error(`Font ${src}: download stalled`)), STALL_TIMEOUT_MS);
	};
	progress();
	try {
		const response = await fetchFont(src, controller.signal, fetcher, options);
		progress();
		const reader = response.body?.getReader();
		if (!reader) throw new Error(`Font ${src}: download has no streaming body`);
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				progress();
				size += value.byteLength;
				if (size > MAX_FONT_BYTES) throw new Error(`Font ${src}: larger than ${MAX_FONT_BYTES} bytes`);
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
		// A misconfigured static host can answer 200 with HTML or a truncated file; the original hosts are trusted.
		if (options.mirror && !isValidFontFile(bytes)) throw new Error(`Font ${src}: invalid font data`);
		return bytes;
	} finally {
		clearTimeout(stall);
	}
}

let readFont = (src: string, options: FontReadOptions) => downloadFont(src, fetch, options);

/** Replaces how font files are read, e.g. with a persistent cache around `downloadFont` (the mobile app). */
export function configureFontReader(reader: (src: string, options: FontReadOptions) => Promise<Uint8Array>) {
	readFont = reader;
	cache.clear();
}

const load = (src: string, options: FontReadOptions) => {
	let bytes = cache.get(src);
	if (!bytes) {
		bytes = readFont(src, options).then(prepareFontBytes);
		// A failed download may succeed next time.
		bytes.catch(() => cache.delete(src));
		cache.set(src, bytes);
	}
	return bytes;
};

/**
 * The font faces a document needs, as bytes Forme can embed. A face that fails to load is left out and listed in
 * `missing`; Forme falls back to its built-in fonts for that text.
 * The legacy base rewrites Computer Modern only. A full mirror takes precedence and never retries original hosts.
 */
export async function loadFonts(
	requests: readonly PdfFontRequest[],
	webFontBaseUrl?: string,
	fontMirrorUrl?: string,
): Promise<{ fonts: FormeFont[]; warnings: string[]; missing: string[] }> {
	const mirrorBase = webFontBaseUrl?.trim().replace(/\/+$/, "");
	const computerModernBase = "https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest";
	const warnings: string[] = [];
	const missing: string[] = [];
	const loaded = await Promise.all(
		requests.map(async (request): Promise<FormeFont | null> => {
			try {
				const legacySource =
					mirrorBase && request.src.startsWith(computerModernBase)
						? mirrorBase + request.src.slice(computerModernBase.length)
						: request.src;
				const source = fontMirrorUrl ? resolveFontSource(request.src, fontMirrorUrl) : legacySource;
				return {
					family: request.family,
					weight: request.weight,
					italic: request.italic,
					src: await load(source, { mirror: Boolean(fontMirrorUrl) }),
				};
			} catch (error) {
				warnings.push(error instanceof Error ? error.message : `Font ${request.src} could not be loaded.`);
				missing.push(request.family);
				return null;
			}
		}),
	);
	return { fonts: loaded.filter((font): font is FormeFont => font !== null), warnings, missing };
}
