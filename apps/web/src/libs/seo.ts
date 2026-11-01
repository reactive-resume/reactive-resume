import { t } from "@lingui/core/macro";

/**
 * The server writes every page's canonical link, hreflang alternates, social cards and site-wide structured data into
 * the HTML it sends (apps/server/src/static/web.ts), so crawlers that never run JavaScript see them. Routes only set
 * what changes as the visitor navigates: the title, the description and, where needed, `noindex`.
 */

const appName = "Reactive Resume";

export const createNoindexFollowMeta = () => ({ name: "robots", content: "noindex, follow" });

const jsonLdEscapes: Record<string, string> = {
	"<": "\\u003C",
	">": "\\u003E",
	"&": "\\u0026",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

/** JSON for an inline `application/ld+json` script, escaped so no string in it can close the script early. */
export const serializeJsonLd = (data: Record<string, unknown>) =>
	JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (character) => jsonLdEscapes[character] ?? character);

/** The homepage's title and description in the active locale. The prerendered page and the route share them. */
export const getHomepageMeta = () => ({
	title: `${t`Free resume builder with PDF & Word downloads`} | ${appName}`,
	description: t`Free, open-source resume builder. Create, update, and share your resume, with PDF and Word downloads, no ads and no paywall.`,
});

/** The ATS checker's title and description in the active locale. The prerendered page and the route share them. */
export const getAtsCheckerMeta = () => ({
	title: `${t`Free ATS resume checker`} | ${appName}`,
	// Keep under ~120 characters so Google's mobile SERP snippet is not truncated at 3 lines.
	description: t`Check whether software can read your resume PDF. Runs entirely in your browser, so your file is never uploaded.`,
});

export const getTemplatesMeta = () => ({
	title: `${t`Free resume templates with PDF examples`} | ${appName}`,
	description: t`Browse free resume templates, compare one-column and two-column layouts, and download sample PDFs. Customize your resume and export to PDF or Word.`,
});

/** Shared app and saved-document tab title. Marketing pages keep their own search titles. */
export const getPageTitle = (label: string) => `${label} | ${appName}`;
