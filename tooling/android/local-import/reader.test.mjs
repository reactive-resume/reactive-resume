import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, extname } from "node:path";
import { afterAll as after, beforeAll as before, test } from "vite-plus/test";
import { chromium } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { buildLocalImport } from "./build.mjs";

const root = resolve(import.meta.dirname, "../../..");
let output;
let server;
let browser;
let origin;
before(async () => {
	output = await mkdtemp(resolve(tmpdir(), "rr-local-import-"));
	await buildLocalImport(output);
	server = createServer(async (request, response) => {
		try {
			const path = resolve(output, "." + new URL(request.url, "http://local").pathname);
			assert.ok(path.startsWith(output + "/"));
			const file = (await stat(path)).isDirectory() ? resolve(path, "index.html") : path;
			response.setHeader(
				"Content-Type",
				{ ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm" }[
					extname(file)
				] ?? "application/octet-stream",
			);
			response.end(await readFile(file));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
	origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch({ headless: true });
});
after(async () => {
	await browser?.close();
	await new Promise((accept) => server?.close(accept));
	await rm(output, { recursive: true, force: true });
});

async function read(name, bytes) {
	const page = await browser.newPage();
	const requests = [];
	page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
	await page.route("**/*", (route) =>
		route
			.request()
			.url()
			.startsWith(origin + "/")
			? route.continue()
			: route.abort(),
	);
	await page.goto(origin + "/index.html");
	try {
		const result = await page.evaluate(
			(input) =>
				new Promise((accept, reject) => {
					const channel = new MessageChannel();
					const timer = setTimeout(() => reject(new Error("Reader did not answer")), 20000);
					const stages = [];
					channel.port1.onmessage = ({ data }) => {
						const value = JSON.parse(data);
						if (value.stage) stages.push(value.stage);
						else {
							clearTimeout(timer);
							channel.port1.close();
							accept({ ...value, stages });
						}
					};
					window.postMessage("reader", location.origin, [channel.port2]);
					channel.port1.postMessage(JSON.stringify(input));
				}),
			{ name, base64: Buffer.from(bytes).toString("base64"), moreTitle: "More from your file" },
		);
		assert.ok(
			requests.every(({ url, method }) => url.startsWith(origin + "/") && method === "GET"),
			JSON.stringify(requests),
		);
		assert.ok(!requests.some(({ url }) => /file-previews|file-imports|ai\//.test(url)));
		assert.equal(await page.evaluate(() => globalThis.__localImportExecuted), undefined);
		return result;
	} finally {
		await page.close();
	}
}

test("real PDF uses bundled worker and shared parser, retains links and leftovers without uploads", async () => {
	const result = await read(
		"Fictional.pdf",
		await readFile(resolve(root, "packages/api/src/features/resume/fixtures/import-review.pdf")),
	);
	assert.equal(result.error, undefined);
	assert.equal(result.data.basics.name, "Avery Morgan");
	assert.equal(result.pages, 1);
	assert.deepEqual(result.stages, [1, 2]);
	const all = JSON.stringify(result.data);
	assert.ok(all.includes("https://www.linkedin.com/in/fictional-avery-morgan-rx216/"));
	assert.ok(all.includes("Completed independent research on accessible interfaces."));
});

test("malformed, scanned and partial PDFs fail without a server fallback", async () => {
	assert.equal((await read("bad.pdf", Buffer.from("%PDF-truncated"))).error, "unreadable");
	assert.equal(
		(await read("scan.pdf", await readFile(resolve(root, "packages/pdf/fixtures/ats/image-only-scan.pdf")))).error,
		"scanned",
	);
	assert.equal(
		(
			await read(
				"long.pdf",
				await readFile(resolve(root, "packages/api/src/features/resume/fixtures/import-review-long.pdf")),
			)
		).error,
		"partial",
	);
});

function mixedPdf(secondPage) {
	const text = "BT /F1 20 Tf 50 750 Td (Fictional Local) Tj 0 -30 Td /F1 12 Tf (fictional@example.invalid) Tj ET";
	const second =
		secondPage === "image"
			? "q 595 0 0 842 0 0 cm /Im1 Do Q"
			: secondPage === "paths"
				? "0 0 0 rg 50 500 200 50 re f"
				: "q Q";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>",
		`<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
		"<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 3 >>\nstream\n00>\nendstream",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const start = Buffer.byteLength(pdf);
	pdf += `xref\n0 9\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
	return Buffer.from(pdf);
}

test("mixed text/raster and text/outlined pages refuse partial import; genuinely blank page remains importable", async () => {
	for (const second of ["image", "paths"]) {
		const result = await read(`mixed-${second}.pdf`, mixedPdf(second));
		assert.equal(result.error, "partial");
		assert.equal(result.data, undefined);
	}
	const blank = await read("text-and-blank.pdf", mixedPdf("blank"));
	assert.equal(blank.error, undefined);
	assert.equal(blank.pages, 2);
	assert.equal(blank.data.basics.name, "Fictional Local");
});

test("password-protected PDF reports password error without uploading", async () => {
	// A valid Standard encryption dictionary needs a password before any page content can be read.
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
		`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${"00".repeat(32)}> /U <${"00".repeat(32)}> /P -4 >>`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const start = Buffer.byteLength(pdf);
	pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join(
			"",
		)}trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<0011223344556677><0011223344556677>] >>\nstartxref\n${start}\n%%EOF`;
	assert.equal((await read("protected.pdf", Buffer.from(pdf))).error, "password");
});

test("PDF JavaScript actions and imported HTML never execute", async () => {
	const stream = "BT /F1 20 Tf 50 750 Td (Fictional Reader) Tj 0 -30 Td /F1 12 Tf (reader@example.invalid) Tj ET";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /S /JavaScript /JS (globalThis.__localImportExecuted=true;) >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	}
	const start = Buffer.byteLength(pdf);
	pdf += `xref\n0 7\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
		.join("")}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
	const result = await read("actions.pdf", Buffer.from(pdf));
	assert.equal(result.data.basics.name, "Fictional Reader");
	await read(
		"resume.json",
		Buffer.from(
			JSON.stringify({
				basics: { name: "Fictional" },
				work: [
					{
						name: "Example",
						summary: '<script>globalThis.__localImportExecuted=true</script><img src="https://external.invalid/leak">',
					},
				],
			}),
		),
	);
});

test("JSON Resume, account-envelope Reactive Resume and LinkedIn ZIP use shared local converters", async () => {
	const json = await read(
		"resume.json",
		Buffer.from(
			JSON.stringify({
				basics: { name: "Fictional Local", label: "Engineer" },
				work: [{ name: "Example", position: "Engineer" }],
			}),
		),
	);
	assert.equal(json.data.basics.name, "Fictional Local");
	assert.equal(json.data.sections.experience.items[0].company, "Example");
	const wrapped = await read("account-resume.json", Buffer.from(JSON.stringify({ data: json.data })));
	assert.equal(wrapped.data.basics.name, "Fictional Local");
	const zip = zipSync({ "Profile.csv": strToU8("First Name,Last Name,Headline\nFictional,Local,Engineer\n") });
	assert.equal((await read("export.zip", zip)).data.basics.name, "Fictional Local");
	assert.equal((await read("bad.json", Buffer.from('{"unrelated":true}'))).error, "wrong-type");
	assert.equal((await read("bad.zip", Buffer.from("bad"))).error, "unreadable");
});

test("oversized files are rejected before parsing", async () => {
	assert.equal((await read("large.pdf", Buffer.alloc(10 * 1024 * 1024 + 1))).error, "too-large");
});
