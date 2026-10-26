import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatter } from "@lingui/format-po";

const titles = [
	"Summary",
	"Profiles",
	"Experience",
	"Education",
	"Projects",
	"Skills",
	"Languages",
	"Interests",
	"Awards",
	"Certifications",
	"Publications",
	"Volunteer",
	"References",
	"Cover Letter",
];

/** Only default resume headings are needed by the PDF renderer, not the entire application catalog. */
export const generateSectionTitleCatalog = (catalogDirectory: string) => generateCatalog(catalogDirectory, titles);

/** "Present" as printed in resume dates, per locale; untranslated locales carry the English source. */
export async function generatePresentLabels(catalogDirectory: string) {
	const catalog = await generateCatalog(catalogDirectory, ["Present"]);
	return Object.fromEntries(Object.entries(catalog).map(([locale, messages]) => [locale, messages.Present]));
}

/** The web page's interface text per locale, declared for extraction in apps/web's `web-page-text.ts`. */
export const generateWebPageCatalog = (catalogDirectory: string, messages: readonly string[]) =>
	generateCatalog(catalogDirectory, messages);

async function generateCatalog(catalogDirectory: string, titles: readonly string[]) {
	const result: Record<string, Record<string, string>> = {};
	for (const filename of (await readdir(catalogDirectory)).filter((file) => file.endsWith(".po")).sort()) {
		const locale = filename.slice(0, -3);
		const catalog = await formatter().parse(await readFile(join(catalogDirectory, filename), "utf8"), {
			locale,
			sourceLocale: "en-US",
			filename,
		});
		const messages = Object.values(catalog).filter((message) => !message.obsolete && !message.context);
		result[locale] = Object.fromEntries(
			titles.map((title) => {
				const message = messages.find((message) => message.message === title);
				if (locale === "en-US" && !message) throw new Error(`Missing source message: ${title}`);
				return [title, message?.translation?.trim() ? message.translation : title];
			}),
		);
	}
	return result;
}
