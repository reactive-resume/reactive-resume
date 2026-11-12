import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { binaryPaths, checkBinaries, identity, packageRoot, sha256 } from "./artifact.mjs";

async function main() {
	const { values } = parseArgs({
		options: { platform: { type: "string" }, manifest: { type: "string" } },
	});
	const platform = values.platform;
	if (platform !== "ios" && platform !== "android") {
		if (values.platform) throw new Error("--platform must be ios or android");
		console.log("forme-native: skipped (no --platform).");
		return;
	}
	const manifestPath = values.manifest
		? resolve(values.manifest)
		: fileURLToPath(new URL("./prebuilt.json", import.meta.url));
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) throw new Error("Invalid prebuilt manifest");
	const build = await identity();
	const pins = manifest.artifacts.filter(
		(entry) => entry.sourceHash === build.sourceHash && entry.version === build.version,
	);
	if (pins.length !== 1) throw new Error(`Expected one reviewed artifact pin for ${build.tag}; found ${pins.length}`);
	const pin = pins[0];
	if (!/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error("Missing pinned SHA-256");
	const url = new URL(pin.url);
	if (url.protocol !== "https:" && !(values.manifest && url.protocol === "file:")) {
		throw new Error("Artifact URL must use HTTPS (file: allowed only with explicit local --manifest)");
	}
	const stage = await mkdtemp(join(packageRoot, ".prebuilt-"));
	try {
		let bytes;
		if (url.protocol === "file:") bytes = await readFile(url);
		else {
			const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
			if (!response.ok) throw new Error(`Artifact download failed: HTTP ${response.status}`);
			if (new URL(response.url).protocol !== "https:") throw new Error("Artifact redirected away from HTTPS");
			bytes = new Uint8Array(await response.arrayBuffer());
		}
		if (sha256(bytes) !== pin.sha256) throw new Error("Artifact SHA-256 mismatch; refusing to install");
		const archive = join(stage, "artifact.tar.gz");
		await writeFile(archive, bytes);
		const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
		for (const entry of entries) {
			if (
				entry.split("/").some((part) => part === "..") ||
				!binaryPaths.some((path) => entry === path || entry.startsWith(`${path}/`))
			) {
				throw new Error(`Unexpected archive path: ${entry}`);
			}
		}
		const types = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).trim().split("\n");
		if (types.some((entry) => !/^[-d]/.test(entry))) {
			throw new Error("Only regular files and directories are permitted in prebuilt artifacts");
		}
		execFileSync("tar", ["-xzf", archive, "-C", stage]);
		await checkBinaries(stage);
		// Both platforms are installed together; Android also needs the generated C header.
		for (const path of binaryPaths) {
			await rm(join(packageRoot, path), { recursive: true, force: true });
			await rename(join(stage, path), join(packageRoot, path));
		}
		console.log(`forme-native: verified and installed ${build.tag} for ${platform}.`);
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(
		`forme-native: ${error.message}\nBuild locally on macOS: bash packages/forme-native/rust/build.sh\nFor release builds, publish CI's artifact and commit its reviewed checksum to packages/forme-native/scripts/prebuilt.json.`,
	);
	process.exitCode = 1;
});
