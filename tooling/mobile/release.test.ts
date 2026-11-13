import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { appVersion, nextBuildNumber, prepareRelease, requireSecrets } from "./release";

it.each([
	[0, 0, 1],
	[41, 41, 42],
	[42, 41, 50],
	[41, 42, 50],
	[49, 50, 60],
	[50, 49, 60],
	[50, 0, 60],
	[0, 9, 10],
	[118, 120, 130],
])("iOS %i and Android %i give %i", (ios, android, next) => {
	expect(nextBuildNumber(ios, android)).toBe(next);
});

it("never guesses a number from a missing, partial or out-of-range store reading", () => {
	for (const reading of [{}, { IOS_BUILD_NUMBER: "12" }, { IOS_BUILD_NUMBER: "", ANDROID_VERSION_CODE: "12" }]) {
		expect(() => prepareRelease(reading)).toThrow("latest build number");
	}
	for (const value of ["-1", "1.2", "1e3", " 12", "null"]) {
		expect(() => prepareRelease({ IOS_BUILD_NUMBER: value, ANDROID_VERSION_CODE: "12" })).toThrow();
	}
	expect(prepareRelease({ IOS_BUILD_NUMBER: "12", ANDROID_VERSION_CODE: "12" })).toBe(13);
	expect(() => nextBuildNumber(2_100_000_000, 2_100_000_000)).toThrow("versionCode limit");
	expect(() => nextBuildNumber(Number.NaN, 1)).toThrow();
});

it("names missing signing or store secrets for the platform that needs them", () => {
	const android = {
		PLATFORM: "android",
		ANDROID_KEYSTORE_BASE64: "fixture",
		ANDROID_KEYSTORE_PASSWORD: "fixture",
		ANDROID_KEY_ALIAS: "fixture",
		ANDROID_KEY_PASSWORD: "fixture",
	};
	expect(() => requireSecrets("signing", android)).not.toThrow();
	expect(() => requireSecrets("signing", { ...android, ANDROID_KEY_PASSWORD: " " })).toThrow("ANDROID_KEY_PASSWORD");
	expect(() => requireSecrets("signing", { ...android, PLATFORM: "ios" })).toThrow(
		"IOS_DISTRIBUTION_P12_BASE64, IOS_DISTRIBUTION_P12_PASSWORD, IOS_PROVISION_PROFILE_BASE64, IOS_SHARE_PROVISION_PROFILE_BASE64",
	);
	expect(() => requireSecrets("signing", { ...android, PLATFORM: "all" })).toThrow("Invalid release platform");
	expect(() => requireSecrets("store", { PLATFORM: "all", GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "fixture" })).toThrow(
		"ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY",
	);
	expect(() =>
		requireSecrets("store", { PLATFORM: "android", GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "fixture" }),
	).not.toThrow();
	expect(() => requireSecrets("store", { PLATFORM: "untrusted" })).toThrow("Invalid release platform");
});

it("reads the store version from the app config", async () => {
	expect(await appVersion()).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
});

it("CLI writes only validated outputs and never echoes secret values", () => {
	const directory = mkdtempSync(join(tmpdir(), "mobile-release-"));
	const script = fileURLToPath(new URL("./release.ts", import.meta.url));
	const output = join(directory, "output");
	const run = (args: string[], env: Record<string, string>) =>
		spawnSync(process.execPath, [script, ...args], {
			env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, ...env },
			encoding: "utf8",
		});
	try {
		const prepared = run(["--prepare"], { IOS_BUILD_NUMBER: "7", ANDROID_VERSION_CODE: "12" });
		expect(prepared.status, prepared.stderr).toBe(0);
		const version = run(["--version"], {});
		expect(version.status, version.stderr).toBe(0);
		expect(readFileSync(output, "utf8")).toMatch(/^build_number=20\nversion=[0-9]+\.[0-9]+\.[0-9]+\n$/);
		const invalid = run(["--signing"], { PLATFORM: "android", ANDROID_KEYSTORE_PASSWORD: "private-fixture" });
		expect(invalid.status).toBe(1);
		expect(invalid.stderr).toContain("ANDROID_KEYSTORE_BASE64");
		expect(invalid.stderr).not.toContain("private-fixture");
		expect(run(["--prepare"], { IOS_BUILD_NUMBER: "7" }).status).toBe(1);
		expect(readFileSync(output, "utf8").split("\n")).toHaveLength(3);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
