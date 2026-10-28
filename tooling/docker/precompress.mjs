// Writes a brotli copy (`<file>.br`) beside each text file and WASM module in the built web app. The server's static
// handler sends it to browsers that accept brotli (apps/server/src/static/web.ts); the rest get gzip on the fly.
// Usage: node tooling/docker/precompress.mjs apps/web/dist
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";

const [root] = process.argv.slice(2);
if (!root) throw new Error("Usage: node tooling/docker/precompress.mjs <directory>");

const compress = promisify(brotliCompress);
// HTML pages aren't here: the server rewrites them per request and compresses them then.
const text = new Set([".css", ".js", ".json", ".mjs", ".svg", ".txt", ".webmanifest", ".xml"]);

const entries = await readdir(root, { recursive: true, withFileTypes: true });
const files = entries
	.filter((entry) => entry.isFile() && (text.has(extname(entry.name)) || extname(entry.name) === ".wasm"))
	.map((entry) => join(entry.parentPath, entry.name));

let before = 0;
let after = 0;
await Promise.all(
	files.map(async (file) => {
		const data = await readFile(file);
		// The server doesn't compress responses under 1 KiB either.
		if (data.byteLength < 1024) return;
		const brotli = await compress(data, {
			params: {
				[constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
				[constants.BROTLI_PARAM_MODE]: text.has(extname(file))
					? constants.BROTLI_MODE_TEXT
					: constants.BROTLI_MODE_GENERIC,
				[constants.BROTLI_PARAM_SIZE_HINT]: data.byteLength,
			},
		});
		if (brotli.byteLength >= data.byteLength) return;
		await writeFile(`${file}.br`, brotli);
		before += data.byteLength;
		after += brotli.byteLength;
	}),
);

console.log(`Precompressed ${(before / 1e6).toFixed(1)} MB to ${(after / 1e6).toFixed(1)} MB of brotli.`);
