// Run after pnpm install: node apps/mobile/scripts/hermes-compat.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = new URL("../", import.meta.url);
process.chdir(fileURLToPath(mobile));
const require = createRequire(new URL("package.json", mobile));
// Resolve through React Native so the compiler matches the app's pinned Hermes version.
const hermesRequire = createRequire(require.resolve("react-native/package.json"));
const hostBinary = {
	darwin: "osx-bin/hermesc",
	linux: "linux64-bin/hermesc",
	win32: "win64-bin/hermesc.exe",
}[process.platform];
assert(hostBinary, `Unsupported Hermes compiler host: ${process.platform}`);
const compiler = join(dirname(hermesRequire.resolve("hermes-compiler/package.json")), "hermesc", hostBinary);
const { transformSync } = createRequire(require.resolve("babel-preset-expo"))("@babel/core");
const source = require.resolve("@orpc/client");
const dir = mkdtempSync(join(tmpdir(), "rr-hermes-"));
const compile = (filename, label) => {
	const result = transformSync(readFileSync(filename, "utf8"), {
		filename,
		configFile: fileURLToPath(new URL("babel.config.js", mobile)),
		caller: { name: "metro", platform: "ios", engine: "hermes", isDev: false, supportsStaticESM: false },
	});
	assert(result?.code);
	const input = join(dir, `${label}.js`);
	writeFileSync(input, result.code);
	const compiled = spawnSync(compiler, ["-emit-binary", "-out", join(dir, `${label}.hbc`), input], {
		encoding: "utf8",
	});
	assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
};
try {
	compile(source, "client");
	console.log("PASS: release-transformed oRPC client compiles with app's Hermes compiler.");
	// RX-100 native parity: the pure origin and workspace decisions also survive the release transform.
	compile(fileURLToPath(new URL("../src/features/applications/origin.ts", import.meta.url)), "origin");
	compile(fileURLToPath(new URL("../src/features/workspace/logic.ts", import.meta.url)), "workspace-logic");
	console.log("PASS: application origin and workspace logic compile with the app's Hermes compiler.");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
