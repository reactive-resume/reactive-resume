import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Every resume render downloads its fonts (even Helvetica documents fetch a Noto punctuation fallback), and each test
// file starts with an empty in-memory cache. Keep font downloads on disk so a run fetches each file once, not once per
// test file. Tests that stub `fetch` replace this wrapper and see only their own stub.
const directory = fileURLToPath(new URL("../../node_modules/.cache/fonts/", import.meta.url));
const FONT_HOSTS = new Set(["fonts.gstatic.com", "fonts.gstatic.cn", "cdn.jsdelivr.net"]);
const network = globalThis.fetch;

globalThis.fetch = async (input, init) => {
	const url = new URL(input instanceof Request ? input.url : input);
	if (!FONT_HOSTS.has(url.hostname)) return network(input, init);
	const file =
		directory + encodeURIComponent(url.hostname.replace("fonts.gstatic.cn", "fonts.gstatic.com") + url.pathname);
	const cached = await readFile(file).catch(() => null);
	if (cached) return new Response(cached);
	const response = await network(input, init);
	if (!response.ok) return response;
	const bytes = new Uint8Array(await response.arrayBuffer());
	// Only keep what reads as a font (TrueType, OpenType, WOFF, WOFF2), never an error page.
	const signature = new TextDecoder("latin1").decode(bytes.subarray(0, 4));
	if (!["\0\x01\0\0", "OTTO", "true", "wOFF", "wOF2"].includes(signature)) return new Response(bytes);
	await mkdir(directory, { recursive: true });
	// Parallel workers can fetch the same font; rename makes each write atomic.
	const partial = `${file}.${process.pid}.${Math.random()}`;
	await writeFile(partial, bytes);
	await rename(partial, file);
	return new Response(bytes);
};
