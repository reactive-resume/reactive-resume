import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "vite-plus/test";
import { encode } from "fast-png";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "../server";

it(
	"never requests a user-supplied internal image URL through the server PDF entrypoint",
	{ timeout: 60_000 },
	async () => {
		let requests = 0;
		const server = createServer((_request, response) => {
			requests++;
			response.writeHead(200, { "content-type": "image/png" });
			response.end(
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=",
					"base64",
				),
			);
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing test listener");
			const data = structuredClone(defaultResumeData);
			data.basics.name = "Image boundary";
			data.picture.hidden = false;
			data.picture.url = `http://127.0.0.1:${address.port}/private.png`;
			const file = await createResumePdfFile({ data, filename: "safe.pdf" });
			expect(file.size).toBeGreaterThan(0);
			expect(requests).toBe(0);
		} finally {
			server.close();
			server.closeAllConnections();
			await once(server, "close");
		}
	},
);

it("embeds an uploaded picture stored as a root-relative path", { timeout: 60_000 }, async () => {
	const paths: string[] = [];
	const png = encode({ width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]), channels: 4 });
	const server = createServer((request, response) => {
		paths.push(request.url ?? "");
		response.writeHead(200, { "content-type": "image/png" });
		response.end(png);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test listener");
		const data = structuredClone(defaultResumeData);
		data.basics.name = "Relative picture";
		data.picture.hidden = false;
		data.picture.url = "/uploads/user-1/pictures/picture.png";
		const file = await createResumePdfFile({
			data,
			filename: "picture.pdf",
			uploadOrigin: `http://127.0.0.1:${address.port}`,
		});
		expect(paths).toEqual(["/uploads/user-1/pictures/picture.png"]);
		const loading = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
		const operators = await (await (await loading.promise).getPage(1)).getOperatorList();
		await loading.destroy();
		expect(operators.fnArray).toContain(OPS.paintImageXObject);
	} finally {
		server.close();
		server.closeAllConnections();
		await once(server, "close");
	}
});
