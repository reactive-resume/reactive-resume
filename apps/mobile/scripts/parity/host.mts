// Node-only parity tooling. Never imported by the mobile app.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { templateSchema } from "@reactive-resume/schema/templates";

// Node 24's extension hook matches the existing images.node re-export when this script uses tsx.
registerHooks({
	resolve(specifier, context, next) {
		return next(specifier.startsWith(".") && specifier.endsWith(".node") ? `${specifier}.ts` : specifier, context);
	},
});
const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
const requirePdf = createRequire(import.meta.resolve("@reactive-resume/pdf/server"));
const { getDocument } = await import(pathToFileURL(requirePdf.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);
const picture = await readFile(new URL("../../../web/public/photos/sample-picture.jpg", import.meta.url));
const font = await readFile(new URL("../../assets/fonts/Figtree-Regular.ttf", import.meta.url));
const fontReads: Record<string, number> = {};
const fixture = structuredClone(sampleResumeData);
fixture.picture.url = `data:image/jpeg;base64,${picture.toString("base64")}`;
const output = new URL("../../reports/parity/", import.meta.url);
await mkdir(output, { recursive: true });

type Extracted = { pages: number; text: string[] };
async function extract(bytes: Uint8Array): Promise<Extracted> {
	const loading = getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
	const document = await loading.promise;
	try {
		const text: string[] = [];
		for (let page = 1; page <= document.numPages; page++) {
			const content = await (await document.getPage(page)).getTextContent();
			text.push(content.items.map((item: { str?: string }) => item.str ?? "").join(""));
		}
		return { pages: document.numPages, text };
	} finally {
		await loading.destroy();
	}
}

const baselines = new Map<string, Extracted>();
const cases = [...templateSchema.options, "free-form"];
for (const name of cases) {
	const data = structuredClone(fixture);
	if (name === "free-form") data.metadata.page.format = "free-form";
	const template = name === "free-form" ? "azurill" : templateSchema.parse(name);
	const file = await createResumePdfFile({ data, template, filename: `${name}.pdf` });
	const baseline = await extract(new Uint8Array(await file.arrayBuffer()));
	baselines.set(name, baseline);
	console.log(`Node ${name}: ${baseline.pages} pages`);
}
const results: Record<string, Record<string, unknown>[]> = {};
const server = createServer(async (request, response) => {
	try {
		const url = new URL(request.url ?? "/", "http://localhost:18086");
		if (request.method === "GET" && url.pathname === "/fixture") {
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify(fixture));
			return;
		}
		if (request.method === "GET" && url.pathname === "/font.ttf") {
			const platform = url.searchParams.get("platform") ?? "unknown";
			fontReads[platform] = (fontReads[platform] ?? 0) + 1;
			response.end(font);
			return;
		}
		if (request.method === "GET" && url.pathname === "/invalid-font") {
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end("<html>HTTP 200 font error</html>");
			return;
		}
		if (request.method === "GET" && url.pathname === "/font-reads") {
			response.end(JSON.stringify(fontReads[url.searchParams.get("platform") ?? "unknown"] ?? 0));
			return;
		}
		if (request.method === "GET" && url.pathname === "/picture.jpg") {
			response.setHeader("Content-Type", "image/jpeg");
			response.end(picture);
			return;
		}
		if (request.method === "GET" && url.pathname === "/oversize") {
			response.writeHead(200, { "Content-Type": "application/octet-stream" });
			response.end(Buffer.alloc(12_000_001));
			return;
		}
		if (request.method === "POST" && url.pathname === "/result") {
			const platform = url.searchParams.get("platform");
			assert(platform === "ios" || platform === "android");
			const name = url.searchParams.get("template") ?? "";
			const baseline = baselines.get(name);
			assert(baseline);
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of request) {
				size += chunk.length;
				assert(size <= 20_000_000);
				chunks.push(chunk);
			}
			const actual = await extract(new Uint8Array(Buffer.concat(chunks)));
			const sameText =
				actual.text.length === baseline.text.length &&
				actual.text.every((text, index) => text === baseline.text[index]);
			const entry = {
				template: name,
				pages: actual.pages,
				expectedPages: baseline.pages,
				textEqual: sameText,
				passes: Number(url.searchParams.get("passes")),
				milliseconds: Number(url.searchParams.get("ms")),
				rasterized: Number(url.searchParams.get("rasterized")),
				pass: actual.pages === baseline.pages && sameText,
			};
			results[platform] ??= [];
			results[platform] = results[platform].filter((result) => result.template !== name).concat(entry);
			await writeFile(new URL(`${platform}-parity.json`, output), JSON.stringify(results[platform], null, 2) + "\n");
			console.log(
				`${platform} ${name}: ${entry.pass ? "PASS" : "FAIL"}, ${actual.pages} pages, ${entry.passes} engine passes`,
			);
			response.setHeader("Content-Type", "application/json");
			response.end(JSON.stringify(entry));
			return;
		}
		response.writeHead(404);
		response.end();
	} catch (error) {
		console.error("Parity request failed:", error instanceof Error ? error.name : "error");
		response.writeHead(500);
		response.end("Parity failure");
	}
});
server.listen(18086, "127.0.0.1", () => console.log("Parity host ready on 127.0.0.1:18086"));
