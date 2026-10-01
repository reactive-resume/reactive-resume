import { once } from "node:events";
import { createServer } from "node:http";
import { expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "./images";
import { readServerImage } from "./images.node";

vi.mock("node:dns", () => ({
	lookup: (
		_host: string,
		_options: unknown,
		callback: (error: null, addresses: { address: string; family: number }[]) => void,
	) => callback(null, [{ address: "127.0.0.1", family: 4 }]),
}));

it("bounds trusted uploads and rejects private redirects, rebinding, and unrelated internal paths", async () => {
	let requests = 0;
	let mode = "ok";
	const server = createServer((_request, response) => {
		requests++;
		if (mode === "redirect") {
			response.writeHead(302, { location: "/private.png" });
			response.end();
		} else if (mode === "size") {
			response.writeHead(200);
			response.end(Buffer.alloc(MAX_IMAGE_BYTES + 1));
		} else if (mode === "hang") {
			/* Wait for the client's deadline. */
		} else response.end("image bytes");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing listener");
		const origin = `http://127.0.0.1:${address.port}`;
		const picture = `${origin}/api/uploads/user/pictures/picture.png`;
		expect(Buffer.from(await readServerImage(picture, origin)).toString()).toBe("image bytes");
		await expect(readServerImage(`${origin}/private.png`, origin)).rejects.toThrow(/refused/);
		await expect(readServerImage(`http://rebound.example:${address.port}/picture.png`)).rejects.toThrow(/Private/);
		expect(requests).toBe(1);
		mode = "redirect";
		await expect(readServerImage(picture, origin)).rejects.toThrow(/refused/);
		expect(requests).toBe(2);
		mode = "size";
		await expect(readServerImage(picture, origin)).rejects.toThrow(/12 MB/);
		mode = "hang";
		await expect(readServerImage(picture, origin, AbortSignal.timeout(20))).rejects.toThrow();
	} finally {
		server.close();
		server.closeAllConnections();
		await once(server, "close");
	}
});
