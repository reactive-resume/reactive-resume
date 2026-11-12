import assert from "node:assert/strict";
import { test } from "node:test";
import { load, mobileRequire } from "./harness.mjs";

function configuration(readFlags, files = new Map()) {
	class Directory {
		create() {}
	}
	class File {
		constructor(_directory, key) {
			this.key = key;
		}
		get exists() {
			return files.has(this.key);
		}
		async text() {
			return files.get(this.key);
		}
		write(value) {
			files.set(this.key, value);
		}
	}
	return load("../src/preview/font-source.ts", {
		"expo-crypto": {
			CryptoDigestAlgorithm: { SHA256: "sha256" },
			digestStringAsync: async (_algorithm, value) => value,
		},
		"expo-file-system": { Directory, File, Paths: { cache: "cache" } },
		"@reactive-resume/fonts/sources": mobileRequire("@reactive-resume/fonts/sources"),
		"@/auth/oauth": { getFlags: readFlags },
	});
}

test("font configuration deduplicates reads, isolates servers and survives offline restarts", async () => {
	const files = new Map();
	const calls = [];
	const first = configuration(async (server) => {
		calls.push(server);
		return server === "https://old.example" ? {} : { fontMirrorUrl: `${server}/fonts/` };
	}, files);
	assert.deepEqual(
		await Promise.all([first.getFontMirrorUrl("https://a.example"), first.getFontMirrorUrl("https://a.example")]),
		["https://a.example/fonts", "https://a.example/fonts"],
	);
	assert.deepEqual(calls, ["https://a.example"]);
	assert.equal(await first.getFontMirrorUrl("https://old.example"), undefined);
	const offline = configuration(async () => {
		throw new Error("Offline");
	}, files);
	assert.equal(await offline.getFontMirrorUrl("https://a.example"), "https://a.example/fonts");
	assert.equal(await offline.getFontMirrorUrl("https://old.example"), undefined);
	// Nothing known about this server: no mirror, and no downloads either, so cached fonts still render offline.
	assert.equal(await offline.getFontMirrorUrl("https://unseen.example"), undefined);
	assert.equal(offline.isFontSourceUnknown("https://unseen.example"), true);
	assert.equal(offline.isFontSourceUnknown("https://a.example"), false);
});

test("stale configuration is confirmed before rendering, and kept when the server can't be reached", async () => {
	const files = new Map();
	let mirror = "https://fonts.example/v1";
	let offline = false;
	const reader = configuration(async () => {
		if (offline) throw new Error("Offline");
		return { fontMirrorUrl: mirror };
	}, files);
	assert.equal(await reader.getFontMirrorUrl("https://a.example"), "https://fonts.example/v1");
	mirror = "https://fonts.example/v2";
	const now = Date.now;
	Date.now = () => now() + 10 * 60_000;
	try {
		assert.equal(await reader.getFontMirrorUrl("https://a.example"), "https://fonts.example/v2");
		Date.now = () => now() + 20 * 60_000;
		offline = true;
		assert.equal(await reader.getFontMirrorUrl("https://a.example"), "https://fonts.example/v2");
		// A failed read backs off, so a fit's many renders don't each wait on the server.
		offline = false;
		mirror = "https://fonts.example/v3";
		assert.equal(await reader.getFontMirrorUrl("https://a.example"), "https://fonts.example/v2");
		Date.now = () => now() + 21 * 60_000;
		assert.equal(await reader.getFontMirrorUrl("https://a.example"), "https://fonts.example/v3");
	} finally {
		Date.now = now;
	}
});

test("native renders use the captured server policy and invalidate PDF reuse when it changes", async () => {
	let server = "https://a.example";
	let mirror = `${server}/fonts`;
	const renders = [];
	const { createPreviewPipeline } = load("../src/preview/pipeline.ts", {
		"@reactive-resume/forme-native": { nativeEngine: {} },
		"@reactive-resume/pdf/native": {
			renderResumePdf: async (_engine, input) => {
				renders.push(input);
				return new Uint8Array([1]);
			},
		},
		"../../modules/pdf-pages": {
			pdfPages: {
				open: async () => ({ id: String(renders.length), pages: [{}] }),
				rasterize: async () => [],
				close: async () => {},
			},
		},
		"./font-source": { getFontMirrorUrl: async () => mirror },
		"./resources": { configurePreviewResources() {}, readPreviewImage() {} },
		"@/auth/session": { getServer: () => server },
	});
	const pipeline = createPreviewPipeline();
	const request = { id: 1, data: {}, scale: 1 };
	await pipeline.render(request);
	await pipeline.render({ ...request, id: 2 });
	assert.equal(renders.length, 1);
	assert.equal(renders[0].fontMirrorUrl, "https://a.example/fonts");
	server = "https://b.example";
	mirror = "https://b.example/fonts";
	await pipeline.render({ ...request, id: 3 });
	assert.equal(renders.length, 2);
	assert.equal(renders[1].fontMirrorUrl, mirror);
	mirror = "https://b.example/new-fonts";
	await pipeline.render({ ...request, id: 4 });
	assert.equal(renders.length, 3);
	await pipeline.dispose();
});
