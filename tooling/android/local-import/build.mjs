import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "../../..");
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const pdfRoot = resolve(webRequire.resolve("pdfjs-dist/package.json"), "..");

export async function buildLocalImport(outdir) {
	await rm(outdir, { recursive: true, force: true });
	await mkdir(outdir, { recursive: true });
	await build({
		entryPoints: [resolve(import.meta.dirname, "reader.mjs")],
		outfile: resolve(outdir, "reader.js"),
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "chrome100",
		minify: true,
		alias: { "pdfjs-dist": pdfRoot },
		define: { "process.env.NODE_ENV": '"production"' },
	});
	await cp(resolve(import.meta.dirname, "index.html"), resolve(outdir, "index.html"));
	await cp(resolve(pdfRoot, "legacy/build/pdf.worker.min.mjs"), resolve(outdir, "pdf.worker.mjs"));
	for (const name of ["cmaps", "standard_fonts", "wasm"]) {
		await cp(resolve(pdfRoot, name), resolve(outdir, name), { recursive: true });
	}
	await cp(resolve(pdfRoot, "LICENSE"), resolve(outdir, "PDFJS-LICENSE"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const output = process.argv[2];
	if (!output) throw new Error("Pass the generated Android assets directory.");
	await buildLocalImport(resolve(output));
}
