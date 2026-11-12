import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const versionCodeLimit = 2_100_000_000;

// One build number for both stores in a run. Equal store numbers advance by one; otherwise the platforms meet again on
// the next multiple of 10 above the higher one, so a run that reached only one store is never reused.
export function nextBuildNumber(ios: number, android: number) {
	for (const number of [ios, android]) {
		if (!Number.isSafeInteger(number) || number < 0) throw new Error("Store build numbers must be whole numbers");
	}
	const next = ios === android ? ios + 1 : (Math.floor(Math.max(ios, android) / 10) + 1) * 10;
	if (next > versionCodeLimit) throw new Error("Android versionCode limit exceeded");
	return next;
}

// Fastlane writes the store readings as text; anything but a plain integer means a store was not read.
function storeNumber(env: NodeJS.ProcessEnv, name: string) {
	const value = env[name] ?? "";
	if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be the store's latest build number`);
	return Number(value);
}

export function prepareRelease(env: NodeJS.ProcessEnv) {
	return nextBuildNumber(storeNumber(env, "IOS_BUILD_NUMBER"), storeNumber(env, "ANDROID_VERSION_CODE"));
}

const signing = {
	android: ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"],
	ios: [
		"IOS_DISTRIBUTION_P12_BASE64",
		"IOS_DISTRIBUTION_P12_PASSWORD",
		"IOS_PROVISION_PROFILE_BASE64",
		"IOS_SHARE_PROVISION_PROFILE_BASE64",
	],
};
const store = {
	android: ["GOOGLE_PLAY_SERVICE_ACCOUNT_JSON"],
	ios: ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_PRIVATE_KEY"],
};

// Name the missing secrets, never their values. PLATFORM "all" checks both stores (reading build numbers needs both).
export function requireSecrets(kind: "signing" | "store", env: NodeJS.ProcessEnv) {
	const platform = env.PLATFORM ?? "";
	const sets = kind === "signing" ? signing : store;
	if (!["all", "android", "ios"].includes(platform) || (kind === "signing" && platform === "all")) {
		throw new Error("Invalid release platform");
	}
	const required = platform === "all" ? [...sets.android, ...sets.ios] : sets[platform as "android" | "ios"];
	const missing = required.filter((name) => !env[name]?.trim());
	if (missing.length) throw new Error(`Missing Actions secrets: ${missing.join(", ")}`);
}

export async function appVersion() {
	// A computed specifier keeps the app's Expo types out of this package's typecheck; Node strips the type import.
	const config: { version?: string } = (await import(new URL("../../apps/mobile/app.config.ts", import.meta.url).href))
		.default;
	if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(config.version ?? "")) throw new Error("app.config.ts needs a version x.y.z");
	return config.version as string;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const [command] = process.argv.slice(2);
		const output = (line: string) => {
			if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
			appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
		};
		if (command === "--signing") requireSecrets("signing", process.env);
		else if (command === "--store") requireSecrets("store", process.env);
		else if (command === "--version") output(`version=${await appVersion()}`);
		else if (command === "--prepare") output(`build_number=${prepareRelease(process.env)}`);
		else throw new Error("Use --signing, --store, --version or --prepare");
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Mobile release preparation failed");
		process.exitCode = 1;
	}
}
