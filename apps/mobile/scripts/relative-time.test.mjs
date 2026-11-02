import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../package.json", import.meta.url));
const original = Intl.RelativeTimeFormat;
try {
	// Exercise the locale imports shipped by the app on an engine without native relative-time support.
	delete Intl.RelativeTimeFormat;
	const source = readFileSync(new URL("../src/polyfills.ts", import.meta.url), "utf8");
	for (const [, specifier] of source.matchAll(/import "(@formatjs\/intl-relativetimeformat\/[^"\n]+)"/g)) {
		await import(require.resolve(specifier));
	}
	assert.equal(new Intl.RelativeTimeFormat("en-US", { numeric: "auto" }).format(0, "second"), "now");
	assert.equal(new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" }).format(-3, "minute"), "vor 3 Minuten");
	assert.equal(new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" }).format(-3, "minute"), "3 分鐘前");
	const config = readFileSync(new URL("../../web/lingui.config.ts", import.meta.url), "utf8");
	const locales = [...config.matchAll(/"([a-z]{2}-[A-Z]{2})"/g)].map((match) => match[1]);
	assert.ok(locales.length > 0);
	for (const locale of locales) {
		assert.deepEqual(Intl.RelativeTimeFormat.supportedLocalesOf([locale]), [locale]);
	}
} finally {
	Object.defineProperty(Intl, "RelativeTimeFormat", { value: original, configurable: true, writable: true });
}
console.log("PASS shipped native relative-time polyfill and supported locales without native Intl.RelativeTimeFormat");
