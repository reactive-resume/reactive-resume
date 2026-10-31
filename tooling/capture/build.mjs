import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { zipSync } from "fflate";
const here = fileURLToPath(new URL(".", import.meta.url));
const outdir = fileURLToPath(new URL("../../apps/web/public/capture-helper/", import.meta.url));
await mkdir(outdir, { recursive: true });
await build({
	entryPoints: [here + "popup.mjs"],
	bundle: true,
	format: "esm",
	outfile: outdir + "popup.js",
	target: "chrome120",
});
await build({
	entryPoints: [here + "content.ts"],
	bundle: true,
	format: "iife",
	globalName: "RRPosting",
	outfile: outdir + "content.js",
	target: "chrome120",
});
await writeFile(
	outdir + "content.js",
	(await readFile(outdir + "content.js", "utf8")) + "\nRRPosting.captureDocument(document, location.href);\n",
);
for (const file of ["manifest.json", "popup.html"]) await copyFile(here + file, outdir + file);

const files = ["manifest.json", "popup.html", "popup.js", "content.js"];
await writeFile(
	outdir + "../capture-helper.zip",
	zipSync(
		Object.fromEntries(
			await Promise.all(files.map(async (name) => [name, new Uint8Array(await readFile(outdir + name))])),
		),
	),
);
