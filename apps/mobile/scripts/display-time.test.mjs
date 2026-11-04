import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esbuild } from "./harness.mjs";
const root = new URL("../../../", import.meta.url);
const { transformSync } = esbuild;
let locale = "en-US";
let zone = "UTC";
const mocks = {
	"@lingui/core": { i18n: {} },
	"@lingui/core/macro": { t: () => "", ph: (x) => x },
	"@lingui/react/macro": { useLingui: () => ({ i18n: { locale } }) },
	"@tanstack/react-query": {},
	"expo-file-system": {},
	react: {},
	"@reactive-resume/schema/applications/follow-up": {},
	"@/api/client": {},
	"@/auth/session": {},
	"@/features/applications/queries": {},
	"@/features/reminders": {
		deviceTimeZone: () => "UTC",
		isTimeZone: (z) => {
			try {
				new Intl.DateTimeFormat("en-US", { timeZone: z });
				return true;
			} catch {
				return false;
			}
		},
	},
	"@/features/settings/queries": { useProfile: () => ({ data: { timezone: zone } }) },
};
const module = { exports: {} };
const source = readFileSync(new URL("apps/mobile/src/features/application-detail/hooks.ts", root), "utf8");
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
new Function("require", "module", "exports", code)(
	(name) => {
		assert.ok(name in mocks, "missing boundary " + name);
		return mocks[name];
	},
	module,
	module.exports,
);
const results = [];
for (const [l, z] of [
	["en-US", "UTC"],
	["de-DE", "UTC"],
	["en-US", "Europe/Berlin"],
]) {
	locale = l;
	zone = z;
	const instant = new Date("2026-11-04T13:05:00Z");
	const actual = module.exports.useUserTime().time(instant);
	const expected = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(
		instant,
	);
	results.push({ locale, zone, actual, expected, pass: actual === expected });
}
assert.deepEqual(
	results.map(({ pass }) => pass),
	[true, true, true],
	JSON.stringify(results),
);
