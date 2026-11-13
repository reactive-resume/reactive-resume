// Runs before any other module (see index.ts). Hermes with Expo 58 already has structuredClone, AbortSignal.timeout,
// TextDecoder({ fatal }), streaming fetch, URL and btoa/atob (reports/S2.md); these are the remaining gaps.
import { getRandomValues } from "expo-crypto";
// Hermes has no Intl.PluralRules, and every Lingui plural needs it (reports/M2-T1.md has the Intl matrix). Its polyfill
// resolves region-tagged locales such as `en-US` through Intl.Locale, which Hermes lacks too, so that one loads first.
// Both install only when the engine lacks them. Plural rules depend on the language alone, so one data file per
// language of apps/mobile/locales covers every catalog; Portuguese is the exception (pt-PT has its own rules).
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/af.js";
import "@formatjs/intl-pluralrules/locale-data/am.js";
import "@formatjs/intl-pluralrules/locale-data/ar.js";
import "@formatjs/intl-pluralrules/locale-data/az.js";
import "@formatjs/intl-pluralrules/locale-data/bg.js";
import "@formatjs/intl-pluralrules/locale-data/bn.js";
import "@formatjs/intl-pluralrules/locale-data/ca.js";
import "@formatjs/intl-pluralrules/locale-data/cs.js";
import "@formatjs/intl-pluralrules/locale-data/da.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/el.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/es.js";
import "@formatjs/intl-pluralrules/locale-data/fa.js";
import "@formatjs/intl-pluralrules/locale-data/fi.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import "@formatjs/intl-pluralrules/locale-data/he.js";
import "@formatjs/intl-pluralrules/locale-data/hi.js";
import "@formatjs/intl-pluralrules/locale-data/hu.js";
import "@formatjs/intl-pluralrules/locale-data/hy.js";
import "@formatjs/intl-pluralrules/locale-data/id.js";
import "@formatjs/intl-pluralrules/locale-data/it.js";
import "@formatjs/intl-pluralrules/locale-data/ja.js";
import "@formatjs/intl-pluralrules/locale-data/km.js";
import "@formatjs/intl-pluralrules/locale-data/kn.js";
import "@formatjs/intl-pluralrules/locale-data/ko.js";
import "@formatjs/intl-pluralrules/locale-data/lt.js";
import "@formatjs/intl-pluralrules/locale-data/lv.js";
import "@formatjs/intl-pluralrules/locale-data/ml.js";
import "@formatjs/intl-pluralrules/locale-data/mr.js";
import "@formatjs/intl-pluralrules/locale-data/ms.js";
import "@formatjs/intl-pluralrules/locale-data/ne.js";
import "@formatjs/intl-pluralrules/locale-data/nl.js";
import "@formatjs/intl-pluralrules/locale-data/no.js";
import "@formatjs/intl-pluralrules/locale-data/or.js";
import "@formatjs/intl-pluralrules/locale-data/pl.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-pluralrules/locale-data/pt-PT.js";
import "@formatjs/intl-pluralrules/locale-data/ro.js";
import "@formatjs/intl-pluralrules/locale-data/ru.js";
import "@formatjs/intl-pluralrules/locale-data/sk.js";
import "@formatjs/intl-pluralrules/locale-data/sl.js";
import "@formatjs/intl-pluralrules/locale-data/sq.js";
import "@formatjs/intl-pluralrules/locale-data/sr.js";
import "@formatjs/intl-pluralrules/locale-data/sv.js";
import "@formatjs/intl-pluralrules/locale-data/ta.js";
import "@formatjs/intl-pluralrules/locale-data/te.js";
import "@formatjs/intl-pluralrules/locale-data/th.js";
import "@formatjs/intl-pluralrules/locale-data/tr.js";
import "@formatjs/intl-pluralrules/locale-data/uk.js";
import "@formatjs/intl-pluralrules/locale-data/uz.js";
import "@formatjs/intl-pluralrules/locale-data/vi.js";
import "@formatjs/intl-pluralrules/locale-data/zh.js";
import "@formatjs/intl-pluralrules/locale-data/zu.js";
// Hermes has no Intl.DisplayNames either, and country pickers (search regions) name countries with it; without it
// they show bare codes such as "DE". Names vary by script and region as well as language, so besides one file per
// language of apps/mobile/locales, zh-TW needs zh-Hant (traditional characters) and pt-PT its own names. sr-SP
// catalogs are Cyrillic, which is what sr.js holds. It also installs only when the engine lacks it.
import "@formatjs/intl-displaynames/polyfill.js";
import "@formatjs/intl-displaynames/locale-data/af.js";
import "@formatjs/intl-displaynames/locale-data/am.js";
import "@formatjs/intl-displaynames/locale-data/ar.js";
import "@formatjs/intl-displaynames/locale-data/az.js";
import "@formatjs/intl-displaynames/locale-data/bg.js";
import "@formatjs/intl-displaynames/locale-data/bn.js";
import "@formatjs/intl-displaynames/locale-data/ca.js";
import "@formatjs/intl-displaynames/locale-data/cs.js";
import "@formatjs/intl-displaynames/locale-data/da.js";
import "@formatjs/intl-displaynames/locale-data/de.js";
import "@formatjs/intl-displaynames/locale-data/el.js";
import "@formatjs/intl-displaynames/locale-data/en.js";
import "@formatjs/intl-displaynames/locale-data/es.js";
import "@formatjs/intl-displaynames/locale-data/fa.js";
import "@formatjs/intl-displaynames/locale-data/fi.js";
import "@formatjs/intl-displaynames/locale-data/fr.js";
import "@formatjs/intl-displaynames/locale-data/he.js";
import "@formatjs/intl-displaynames/locale-data/hi.js";
import "@formatjs/intl-displaynames/locale-data/hu.js";
import "@formatjs/intl-displaynames/locale-data/hy.js";
import "@formatjs/intl-displaynames/locale-data/id.js";
import "@formatjs/intl-displaynames/locale-data/it.js";
import "@formatjs/intl-displaynames/locale-data/ja.js";
import "@formatjs/intl-displaynames/locale-data/km.js";
import "@formatjs/intl-displaynames/locale-data/kn.js";
import "@formatjs/intl-displaynames/locale-data/ko.js";
import "@formatjs/intl-displaynames/locale-data/lt.js";
import "@formatjs/intl-displaynames/locale-data/lv.js";
import "@formatjs/intl-displaynames/locale-data/ml.js";
import "@formatjs/intl-displaynames/locale-data/mr.js";
import "@formatjs/intl-displaynames/locale-data/ms.js";
import "@formatjs/intl-displaynames/locale-data/ne.js";
import "@formatjs/intl-displaynames/locale-data/nl.js";
import "@formatjs/intl-displaynames/locale-data/no.js";
import "@formatjs/intl-displaynames/locale-data/or.js";
import "@formatjs/intl-displaynames/locale-data/pl.js";
import "@formatjs/intl-displaynames/locale-data/pt.js";
import "@formatjs/intl-displaynames/locale-data/pt-PT.js";
import "@formatjs/intl-displaynames/locale-data/ro.js";
import "@formatjs/intl-displaynames/locale-data/ru.js";
import "@formatjs/intl-displaynames/locale-data/sk.js";
import "@formatjs/intl-displaynames/locale-data/sl.js";
import "@formatjs/intl-displaynames/locale-data/sq.js";
import "@formatjs/intl-displaynames/locale-data/sr.js";
import "@formatjs/intl-displaynames/locale-data/sv.js";
import "@formatjs/intl-displaynames/locale-data/ta.js";
import "@formatjs/intl-displaynames/locale-data/te.js";
import "@formatjs/intl-displaynames/locale-data/th.js";
import "@formatjs/intl-displaynames/locale-data/tr.js";
import "@formatjs/intl-displaynames/locale-data/uk.js";
import "@formatjs/intl-displaynames/locale-data/uz.js";
import "@formatjs/intl-displaynames/locale-data/vi.js";
import "@formatjs/intl-displaynames/locale-data/zh.js";
import "@formatjs/intl-displaynames/locale-data/zh-Hant.js";
import "@formatjs/intl-displaynames/locale-data/zu.js";
// Posting read receipts need relative time on Hermes; reuse the same supported locale data as country names.
import "@formatjs/intl-relativetimeformat/polyfill.js";
import "@formatjs/intl-relativetimeformat/locale-data/af.js";
import "@formatjs/intl-relativetimeformat/locale-data/am.js";
import "@formatjs/intl-relativetimeformat/locale-data/ar.js";
import "@formatjs/intl-relativetimeformat/locale-data/az.js";
import "@formatjs/intl-relativetimeformat/locale-data/bg.js";
import "@formatjs/intl-relativetimeformat/locale-data/bn.js";
import "@formatjs/intl-relativetimeformat/locale-data/ca.js";
import "@formatjs/intl-relativetimeformat/locale-data/cs.js";
import "@formatjs/intl-relativetimeformat/locale-data/da.js";
import "@formatjs/intl-relativetimeformat/locale-data/de.js";
import "@formatjs/intl-relativetimeformat/locale-data/el.js";
import "@formatjs/intl-relativetimeformat/locale-data/en.js";
import "@formatjs/intl-relativetimeformat/locale-data/es.js";
import "@formatjs/intl-relativetimeformat/locale-data/fa.js";
import "@formatjs/intl-relativetimeformat/locale-data/fi.js";
import "@formatjs/intl-relativetimeformat/locale-data/fr.js";
import "@formatjs/intl-relativetimeformat/locale-data/he.js";
import "@formatjs/intl-relativetimeformat/locale-data/hi.js";
import "@formatjs/intl-relativetimeformat/locale-data/hu.js";
import "@formatjs/intl-relativetimeformat/locale-data/hy.js";
import "@formatjs/intl-relativetimeformat/locale-data/id.js";
import "@formatjs/intl-relativetimeformat/locale-data/it.js";
import "@formatjs/intl-relativetimeformat/locale-data/ja.js";
import "@formatjs/intl-relativetimeformat/locale-data/km.js";
import "@formatjs/intl-relativetimeformat/locale-data/kn.js";
import "@formatjs/intl-relativetimeformat/locale-data/ko.js";
import "@formatjs/intl-relativetimeformat/locale-data/lt.js";
import "@formatjs/intl-relativetimeformat/locale-data/lv.js";
import "@formatjs/intl-relativetimeformat/locale-data/ml.js";
import "@formatjs/intl-relativetimeformat/locale-data/mr.js";
import "@formatjs/intl-relativetimeformat/locale-data/ms.js";
import "@formatjs/intl-relativetimeformat/locale-data/ne.js";
import "@formatjs/intl-relativetimeformat/locale-data/nl.js";
import "@formatjs/intl-relativetimeformat/locale-data/no.js";
import "@formatjs/intl-relativetimeformat/locale-data/or.js";
import "@formatjs/intl-relativetimeformat/locale-data/pl.js";
import "@formatjs/intl-relativetimeformat/locale-data/pt.js";
import "@formatjs/intl-relativetimeformat/locale-data/pt-PT.js";
import "@formatjs/intl-relativetimeformat/locale-data/ro.js";
import "@formatjs/intl-relativetimeformat/locale-data/ru.js";
import "@formatjs/intl-relativetimeformat/locale-data/sk.js";
import "@formatjs/intl-relativetimeformat/locale-data/sl.js";
import "@formatjs/intl-relativetimeformat/locale-data/sq.js";
import "@formatjs/intl-relativetimeformat/locale-data/sr.js";
import "@formatjs/intl-relativetimeformat/locale-data/sv.js";
import "@formatjs/intl-relativetimeformat/locale-data/ta.js";
import "@formatjs/intl-relativetimeformat/locale-data/te.js";
import "@formatjs/intl-relativetimeformat/locale-data/th.js";
import "@formatjs/intl-relativetimeformat/locale-data/tr.js";
import "@formatjs/intl-relativetimeformat/locale-data/uk.js";
import "@formatjs/intl-relativetimeformat/locale-data/uz.js";
import "@formatjs/intl-relativetimeformat/locale-data/vi.js";
import "@formatjs/intl-relativetimeformat/locale-data/zh.js";
import "@formatjs/intl-relativetimeformat/locale-data/zh-Hant.js";
import "@formatjs/intl-relativetimeformat/locale-data/zu.js";

// `uuid` (v7 ids in @reactive-resume/utils/string) needs a CSPRNG.
if (typeof globalThis.crypto?.getRandomValues !== "function") {
	const crypto = (globalThis.crypto ?? {}) as Crypto;
	Object.defineProperty(crypto, "getRandomValues", { value: getRandomValues, configurable: true, writable: true });
	if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
}

// @reactive-resume/resume/section-sort uses it.
if (!Array.prototype.toSorted) {
	Object.defineProperty(Array.prototype, "toSorted", {
		value: function toSorted<T>(this: T[], compare?: (a: T, b: T) => number) {
			return [...this].sort(compare);
		},
		configurable: true,
		writable: true,
	});
}
