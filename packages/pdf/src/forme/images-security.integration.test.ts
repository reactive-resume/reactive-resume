import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it } from "vitest";
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
