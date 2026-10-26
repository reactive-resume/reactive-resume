import webPageCatalog from "./web-page-catalog.json";

/** The interface text on a web page, in English; `web-page-catalog.json` translates it (`pnpm pdf:translations`). */
const ENGLISH = {
	downloadPdf: "Download PDF",
	share: "Share",
	linkCopied: "Link copied",
	showContactDetails: "Show contact details",
	credit: "Made with Reactive Resume, free and open source",
	passwordTitle: "This resume is password-protected",
	passwordHint: "Enter the password the resume owner shared with you.",
	password: "Password",
	unlock: "Unlock",
	wrongPassword: "That password isn't correct. Check it with the resume owner and try again.",
	unavailableTitle: "This resume isn't shared right now.",
	unavailableHint: "If someone sent you this link, ask them for a new one.",
};

export type WebPageMessages = typeof ENGLISH;

/** The English source strings, as the catalog generator looks them up. */
export const WEB_PAGE_SOURCE_MESSAGES = Object.values(ENGLISH);

const catalogs: Record<string, Record<string, string>> = webPageCatalog;

/** The page's interface text in `locale`, falling back to English string by string. */
export function webPageMessages(locale: string): WebPageMessages {
	const catalog = Object.hasOwn(catalogs, locale) ? catalogs[locale] : undefined;
	return Object.fromEntries(
		Object.entries(ENGLISH).map(([key, english]) => [key, catalog?.[english] || english]),
	) as WebPageMessages;
}

/** The catalog locale closest to a visitor's `Accept-Language`, for pages with no resume to take a language from. */
export function localeFromAcceptLanguage(header: string | null): string {
	const locales = Object.keys(catalogs);
	for (const part of (header ?? "").split(",")) {
		const tag = part.split(";")[0]?.trim().toLowerCase();
		if (!tag) continue;
		const exact = locales.find((locale) => locale.toLowerCase() === tag);
		if (exact) return exact;
		const language = locales.find((locale) => locale.toLowerCase().split("-")[0] === tag.split("-")[0]);
		if (language) return language;
	}
	return "en-US";
}
