import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error("Pass an absolute task-owned evidence directory.");
await mkdir(output, { recursive: true });

// Fixed ASCII fictional content: valid one-page PDFs, no font/network/render-service dependency.
function pdf(text) {
	const stream = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let body = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(body));
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const xref = Buffer.byteLength(body);
	body += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
	return Buffer.from(body + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const files = {
	resume: pdf("Maya Chen - Synthetic resume v3 - Fictional Tools engineer"),
	letter: pdf("Maya Chen - Synthetic letter v2 - I build accessible tools"),
};
for (const [kind, bytes] of Object.entries(files)) await writeFile(resolve(output, `${kind}.pdf`), bytes);
const other = createServer((request, response) => {
	if (request.method !== "GET") return response.writeHead(405).end();
	response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
	response.end('<!doctype html><label>Other origin employer field <input type="text"></label>');
});
await new Promise((accept) => other.listen(0, "127.0.0.1", accept));
const otherAddress = other.address();
if (!otherAddress || typeof otherAddress === "string") throw new Error("Missing origin port.");
const bundle = await build({
	entryPoints: [fileURLToPath(new URL("lab.ts", import.meta.url))],
	bundle: true,
	write: false,
	minify: true,
	format: "iife",
	target: "es2022",
	define: {
		DOCUMENTS: JSON.stringify(
			Object.entries(files).map(([kind, bytes]) => ({
				kind,
				sha256: createHash("sha256").update(bytes).digest("hex"),
			})),
		),
		OTHER_ORIGIN: JSON.stringify(`http://127.0.0.1:${otherAddress.port}`),
	},
});
const javascript = bundle.outputFiles[0].contents;
await writeFile(resolve(output, "lab.js"), javascript);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RX-75 synthetic experiment</title><style>body{font:16px system-ui;margin:24px auto;padding:0 16px;max-width:760px;background:#f8f7f3;color:#202820}label,input,textarea{display:block;margin:8px 0}input,textarea{box-sizing:border-box;max-width:100%;padding:8px}button{padding:10px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}iframe{width:100%;border:1px solid #777}</style><main></main><script src="/lab.js" defer></script></html>`;
await writeFile(resolve(output, "index.html"), html);
const server = createServer((request, response) => {
	if (request.method !== "GET") return response.writeHead(405).end();
	const path = new URL(request.url, "http://127.0.0.1").pathname;
	response.setHeader("Cache-Control", "no-store");
	if (path === "/lab.js") return response.writeHead(200, { "Content-Type": "application/javascript" }).end(javascript);
	if (path === "/resume.pdf" || path === "/letter.pdf")
		return response
			.writeHead(200, { "Content-Type": "application/pdf" })
			.end(files[path === "/resume.pdf" ? "resume" : "letter"]);
	if (!["/greenhouse", "/lever", "/ashby"].includes(path)) return response.writeHead(404).end();
	response.writeHead(200, { "Content-Type": "text/html" }).end(html);
});
await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing lab port.");
const origin = `http://127.0.0.1:${address.port}`;
await writeFile(
	resolve(output, "server.json"),
	JSON.stringify({ origin, otherOrigin: `http://127.0.0.1:${otherAddress.port}`, pid: process.pid }),
);
console.log(`RX-75 synthetic lab: ${origin}/greenhouse`);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => {
		server.close();
		other.close();
	});
