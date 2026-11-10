import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";
import { localeSchema } from "@reactive-resume/utils/locale";

// Same locales as apps/web/lingui.config.ts. After `lingui extract`, `pnpm lingui:seed` copies the web translations
// of every matching msgid into these catalogs.
export default defineConfig({
	sourceLocale: "en-US",
	pseudoLocale: "zu-ZA",
	locales: [...localeSchema.options],
	fallbackLocales: {
		"zu-ZA": "en-US",
		default: "en-US",
	},
	format: formatter({ lineNumbers: false }),
	catalogs: [
		{
			path: "<rootDir>/locales/{locale}",
			include: ["app", "src"],
		},
	],
});
