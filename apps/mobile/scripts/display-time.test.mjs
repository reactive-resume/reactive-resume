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
// The locale picks its own clock (a forced 24-hour cycle once showed "13:05" to en-US); the profile zone moves the hour.
for (const [l, z, expected] of [
	["en-US", "UTC", /^01:05\sPM$/],
	["de-DE", "UTC", /^13:05$/],
	["en-US", "Europe/Berlin", /^02:05\sPM$/],
]) {
	locale = l;
	zone = z;
	assert.match(module.exports.useUserTime().time(new Date("2026-11-04T13:05:00Z")), expected, `${l} ${z}`);
}
