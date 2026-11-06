import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { configureFontReader, downloadFont, loadFonts } from "./fonts";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	configureFontReader((src, options) => downloadFont(src, fetch, options));
});

const font = (path: string) => ({
	family: "Test",
	weight: 400,
	italic: false,
	src: `https://fonts.gstatic.com${path}`,
});

const computerModernBase = "https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest";
const mirrorBase = "https://fonts.example.com/cm";

it.each([
	[undefined, computerModernBase],
	["", computerModernBase],
	[mirrorBase, mirrorBase],
	[`${mirrorBase}/`, mirrorBase],
	[`${mirrorBase}///`, mirrorBase],
	[` ${mirrorBase}/ `, mirrorBase],
])("uses explicit mirror %s without reading the server environment", async (baseUrl, expectedBase) => {
	vi.stubEnv("WEB_FONT_BASE_URL", "https://unused-env.example/cm");
	vi.resetModules();
	const { loadFonts: loadMirroredFonts } = await import("./fonts");
	const requested: string[] = [];
	vi.stubGlobal("fetch", (source: URL | string) => {
		requested.push(String(source));
		return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
	});
	const requests = [
		{ ...font(""), src: `${computerModernBase}/font/Bright/cmunbmr.woff` },
		{ ...font(""), weight: 700, italic: true, src: `${computerModernBase}/font/Bright/cmunbxo.woff` },
		font("/s/mirror-test/font.ttf"),
	];
	expect((await loadMirroredFonts(requests, baseUrl)).missing).toEqual([]);
	expect(requested).toEqual([
		`${expectedBase}/font/Bright/cmunbmr.woff`,
		`${expectedBase}/font/Bright/cmunbxo.woff`,
		"https://fonts.gstatic.com/s/mirror-test/font.ttf",
	]);
	await loadMirroredFonts(requests, baseUrl);
	expect(requested).toHaveLength(3);
	expect(requests[0]?.src).toBe(`${computerModernBase}/font/Bright/cmunbmr.woff`);
});

it("falls back to fonts.gstatic.cn when fonts.gstatic.com doesn't answer, then starts there", async () => {
	vi.useFakeTimers();
	const requested: string[] = [];
	vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
		requested.push(input.hostname);
		if (input.hostname === "fonts.gstatic.cn") return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
		// Blocked: the request hangs until it's abandoned.
		return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
	});

	const first = loadFonts([font("/s/test/a.ttf")]);
	await vi.advanceTimersByTimeAsync(3000);
	expect((await first).missing).toEqual([]);
	expect(requested).toEqual(["fonts.gstatic.com", "fonts.gstatic.cn"]);

	expect((await loadFonts([font("/s/test/b.ttf")])).missing).toEqual([]);
	expect(requested.at(-1)).toBe("fonts.gstatic.cn");
	expect(requested).toHaveLength(3);
});

it("finishes a slow download that keeps sending, and fails one that stops (#3627)", async () => {
	vi.useFakeTimers();
	// Sends a byte every 20 s, ten times, then ends; a path with "stops" never ends. Aborting errors it, as with fetch.
	vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
		const body = new ReadableStream<Uint8Array>({
			async start(stream) {
				init.signal?.addEventListener("abort", () => stream.error(init.signal?.reason));
				for (let index = 0; index < 10; index++) {
					await new Promise((resolve) => setTimeout(resolve, 20_000));
					stream.enqueue(new Uint8Array([index]));
				}
				if (!input.pathname.includes("stops")) stream.close();
			},
		});
		return Promise.resolve(new Response(body));
	});

	const slow = loadFonts([font("/s/test/slow.ttf")]);
	const stops = loadFonts([font("/s/test/stops.ttf")]);
	await vi.advanceTimersByTimeAsync(300_000);
	expect((await slow).missing).toEqual([]);
	expect((await stops).missing).toEqual(["Test"]);
});

it("uses the configured font reader and native streaming fetch without the global Response constructor", async () => {
	const bytes = new Uint8Array([0, 1, 0, 0, 7, 8, 9]);
	const response = new Response(bytes);
	const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Use the native streaming fetch")));
	vi.stubGlobal("Response", function () {
		throw new Error("Native Response cannot wrap a stream");
	});
	configureFontReader((src) => downloadFont(src, fetcher));

	const loaded = await loadFonts([font("/s/test/native.ttf"), font("/s/test/native.ttf")]);
	expect(loaded.missing).toEqual([]);
	expect(loaded.fonts.map((face) => face.src)).toEqual([bytes, bytes]);
	expect(fetcher).toHaveBeenCalledOnce();
});

it("mirrors Google and Computer Modern together, retains cache isolation and never retries the CDN", async () => {
	const requested: { url: string; redirect: RequestRedirect | undefined }[] = [];
	let missing = false;
	vi.stubGlobal("fetch", (source: URL | string, init: RequestInit) => {
		requested.push({ url: String(source), redirect: init.redirect });
		return Promise.resolve(
			new Response(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), { status: missing ? 404 : 200 }),
		);
	});
	const requests = [font("/s/full/font.ttf"), { ...font(""), src: `${computerModernBase}/font/Serif/cmunrm.woff` }];
	for (const mirror of ["https://fonts.example.com/a", "https://fonts.example.com/b"]) {
		expect((await loadFonts(requests, "https://legacy.example.com/cm", mirror)).missing).toEqual([]);
		await loadFonts(requests, undefined, mirror);
	}
	expect(requested).toHaveLength(4);
	expect(
		requested.every(({ url, redirect }) => url.startsWith("https://fonts.example.com/") && redirect === "error"),
	).toBe(true);
	expect(requested[0]?.url).toBe("https://fonts.example.com/a/fonts.gstatic.com/s/full/font.ttf");
	expect(requested[1]?.url).toContain("/cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest/font/Serif/cmunrm.woff");
	missing = true;
	expect((await loadFonts([font("/s/full/missing.ttf")], undefined, "https://fonts.example.com/a")).missing).toEqual([
		"Test",
	]);
	expect(requested).toHaveLength(5);
	missing = false;
	expect((await loadFonts([font("/s/full/missing.ttf")], undefined, "https://fonts.example.com/a")).missing).toEqual(
		[],
	);
	expect(requested).toHaveLength(6);
});

it("rejects a real HTTP redirect before requesting its destination in mirror mode", async () => {
	let destinationRequests = 0;
	const server = createServer((request, response) => {
		if (request.url === "/font.ttf") response.writeHead(302, { Location: "/unexpected.ttf" });
		else {
			destinationRequests++;
			response.writeHead(200);
		}
		response.end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test server address");
		await expect(downloadFont(`http://127.0.0.1:${address.port}/font.ttf`, fetch, { mirror: true })).rejects.toThrow();
		expect(destinationRequests).toBe(0);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
