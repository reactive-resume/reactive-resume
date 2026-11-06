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

test("font configuration deduplicates concurrent reads and isolates servers, including offline restarts", async () => {
	const files = new Map();
	const calls = [];
	const first = configuration(async (server) => {
		calls.push(server);
		return { fontMirrorUrl: `${server}/fonts/` };
	}, files);
	assert.deepEqual(
		await Promise.all([first.getFontMirrorUrl("https://a.example"), first.getFontMirrorUrl("https://a.example")]),
		["https://a.example/fonts", "https://a.example/fonts"],
	);
	assert.deepEqual(calls, ["https://a.example"]);
	assert.equal(await first.getFontMirrorUrl("https://b.example"), "https://b.example/fonts");
	const offline = configuration(async () => {
		throw new Error("Offline");
	}, files);
	assert.equal(await offline.getFontMirrorUrl("https://a.example"), "https://a.example/fonts");
	assert.equal(await offline.getFontMirrorUrl("https://b.example"), "https://b.example/fonts");
	await assert.rejects(offline.getFontMirrorUrl("https://unseen.example"), /Offline/);
});

test("older servers explicitly retain CDN defaults; a failed read never invents them", async () => {
	const files = new Map();
	await configuration(async () => ({}), files).getFontMirrorUrl("https://old.example");
	const offline = configuration(async () => {
		throw new Error("Offline");
	}, files);
	assert.equal(await offline.getFontMirrorUrl("https://old.example"), undefined);
	files.set("https://bad.example", JSON.stringify({ server: "https://old.example", fontMirrorUrl: null }));
	await assert.rejects(offline.getFontMirrorUrl("https://bad.example"), /Offline/);
});

test("invalid new configuration cannot revive a previously saved CDN default", async () => {
	const server = "https://changed.example";
	const files = new Map([[server, JSON.stringify({ server, fontMirrorUrl: null })]]);
	let offline = false;
	const reader = configuration(async () => {
		if (offline) throw new Error("Offline");
		return { fontMirrorUrl: "https://user:secret@fonts.example" };
	}, files);
	await assert.rejects(reader.getFontMirrorUrl(server), /without credentials/);
	offline = true;
	await assert.rejects(reader.getFontMirrorUrl(server), /Offline/);
	const restarted = configuration(async () => {
		throw new Error("Offline");
	}, files);
	await assert.rejects(restarted.getFontMirrorUrl(server), /Offline/);
	const recovered = configuration(async () => ({ fontMirrorUrl: "https://fonts.example/valid" }), files);
	assert.equal(await recovered.getFontMirrorUrl(server), "https://fonts.example/valid");
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
