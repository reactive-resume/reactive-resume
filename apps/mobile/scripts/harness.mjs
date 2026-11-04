// Shared host-test loader: compile mobile source with esbuild, then run it against explicit mocks. See ../AGENTS.md.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
// The mobile app has no esbuild of its own; borrow the copy that ships with the server's tsx.
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
export const esbuild = createRequire(serverRequire.resolve("tsx"))("esbuild");

// Lingui `t`: a tagged template, or a message descriptor ({ message, comment }).
export const tag = (parts, ...values) =>
	Array.isArray(parts) ? parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "") : parts.message;

// Runs CommonJS code. Every require() must be a key of `mocks`; `globals` become free variables (React, __DEV__, …).
export function run(code, mocks = {}, globals = {}) {
	const module = { exports: {} };
	new Function("require", "module", "exports", ...Object.keys(globals), code)(
		(name) => {
			assert.ok(name in mocks, `Missing boundary: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
		...Object.values(globals),
	);
	return module.exports;
}

// One file, path relative to this directory or a file URL. `append` runs after it, with access to its locals.
// Other options go to esbuild's transformSync.
export function load(path, mocks = {}, { globals, append = "", ...options } = {}) {
	const file = new URL(path, import.meta.url);
	const { code } = esbuild.transformSync(readFileSync(file, "utf8"), {
		loader: file.pathname.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "automatic",
		...options,
	});
	return run(code + append, mocks, globals);
}

// A file bundled with the imports it reaches; only `mocks` keys stay external. Other options go to buildSync.
export function bundle(path, mocks = {}, { globals, ...options } = {}) {
	const [output] = esbuild.buildSync({
		entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
		bundle: true,
		platform: "node",
		format: "cjs",
		jsx: "automatic",
		write: false,
		external: Object.keys(mocks),
		...options,
	}).outputFiles;
	return run(output.text, mocks, globals);
}
