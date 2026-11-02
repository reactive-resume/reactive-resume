import type { Locale } from "@reactive-resume/utils/locale";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { env } from "@reactive-resume/env/server";
import { jsonLdScript, socialMetaTags } from "@reactive-resume/pdf/web-page-document";
import { templateSchema } from "@reactive-resume/schema/templates";
import { isAppSectionPath, RESERVED_SEGMENTS } from "@reactive-resume/utils/app-paths";
import { defaultLocale, getLocaleAlternates, localizedUrl } from "@reactive-resume/utils/locale";
import { escapeHtml } from "@reactive-resume/utils/string";
import { getPageLocale } from "./locale";
import { CONTEXT7_ASK_DESCRIPTION, CONTEXT7_ASK_URL } from "./seo";

function resolveWebDistPath() {
	const candidates = [
		// Source layout: apps/server/src/static/web.ts -> apps/web/dist
		fileURLToPath(new URL("../../../web/dist", import.meta.url)),
		// Bundled layout: apps/server/dist/index.mjs -> apps/web/dist
		fileURLToPath(new URL("../../web/dist", import.meta.url)),
	];
	const [fallback] = candidates;
	if (!fallback) throw new Error("Could not resolve web dist path");

	return candidates.find((candidate) => existsSync(candidate)) ?? fallback;
}

const staticRoot = resolveWebDistPath();
const indexHtmlPath = `${staticRoot}/index.html`;
// The marketing pages prerendered per locale by the web build (apps/web/vite.config.ts), as <page>/<locale>.html, kept
// beside dist/ so they're never served at an address of their own.
const prerenderRoot = `${staticRoot}-prerender`;
/**
 * Marketing pages the SPA owns that search engines should index.
 *
 * Without an entry here the fallback below returns 404 for the path in production — the dev Vite
 * server serves the shell for anything, so this failure only ever shows up once deployed.
 */
const indexableAppPaths = new Set(["/ats-checker", "/resume-templates"]);
const reservedPublicResumeSegments = new Set<string>(RESERVED_SEGMENTS);

function isAssetPath(pathname: string): boolean {
	return pathname.split("/").pop()?.includes(".") ?? false;
}

function getPathSegments(pathname: string) {
	return pathname.split("/").filter(Boolean);
}

export function isPublicResumePath(pathname: string): boolean {
	const segments = getPathSegments(pathname);
	const [firstSegment] = segments;

	return segments.length === 2 && firstSegment !== undefined && !reservedPublicResumeSegments.has(firstSegment);
}

// Single-segment addresses the app or the server answer themselves, so they can never be a username's page.
const reservedProfileSegments = new Set([...reservedPublicResumeSegments, "cards", "sitemaps", "index.html"]);

/** `/<username>`: an account's primary resume. */
export function isProfilePath(pathname: string): boolean {
	const segments = getPathSegments(pathname);
	const [segment] = segments;
	return segments.length === 1 && segment !== undefined && !reservedProfileSegments.has(segment);
}

/**
 * Scripts run only from the app's own files and the inline scripts of the page served, allowed by hash; `wasm-unsafe-eval`
 * lets the PDF engine (Forme, WebAssembly) start. Pictures, avatars and fonts can live on any https host (a resume's
 * picture URL, a sign-in provider's avatar) and the PDF engine fetches them, so images, fonts and connections stay open
 * to https. Recordings, previews and workers use blob: URLs. Cloudflare Web Analytics, when turned on for the zone, injects
 * its real-user metrics beacon from static.cloudflareinsights.com.
 */
export function contentSecurityPolicy(html = "") {
	const inlineScripts = html.matchAll(
		/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g,
	);
	const hashes = [...inlineScripts].map(
		([, body]) =>
			`'sha256-${createHash("sha256")
				.update(body ?? "")
				.digest("base64")}'`,
	);
	return [
		"default-src 'self'",
		["script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com", ...hashes].join(" "),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data: https:",
		"connect-src 'self' data: blob: https:",
		"media-src 'self' data: blob:",
		"worker-src 'self' blob:",
		"frame-src 'self' blob:",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		// Print and template previews show a PDF from a blob: URL, which Chromium's viewer loads as a plugin.
		"object-src blob:",
	].join("; ");
}

export const BASE_SECURITY_HEADERS = {
	Link: `<${CONTEXT7_ASK_URL}>; rel="search"; type="text/plain"; title="Search rxresu.me"`,
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Content-Security-Policy": contentSecurityPolicy(),
};

/**
 * Preload links for the stylesheet and fonts a page's <head> loads. Cloudflare sends them ahead of the page as 103 Early
 * Hints, so they download while the origin is still answering.
 */
function preloadLinks(html: string) {
	const end = html.indexOf("</head>");
	const head = end === -1 ? html : html.slice(0, end);
	return [...head.matchAll(/<link\b[^>]*>/g)].flatMap(([tag]) => {
		const href = tag.match(/\bhref="(\/assets\/[^"]+)"/)?.[1];
		// The preload must share the tag's CORS mode, or the browser downloads the file twice.
		const cors = /\scrossorigin\b/.test(tag) ? "; crossorigin" : "";
		if (href && /\brel="stylesheet"/.test(tag)) return [`<${href}>; rel=preload; as=style${cors}`];
		if (href && /\brel="preload"/.test(tag) && /\bas="font"/.test(tag))
			return [`<${href}>; rel=preload; as=font${cors}`];
		return [];
	});
}

/**
 * An HTML page whose policy allows exactly the inline scripts of its template. Hashes come from the template before
 * any resume-derived markup goes in, so text that slipped past escaping could never allow itself.
 */
function htmlResponse(html: string, headers: Record<string, string>, template = html) {
	const verification = new URL(CONTEXT7_ASK_URL).searchParams.get("siteKey") ?? "";
	const note = `<blockquote data-context7-ask="true" aria-hidden="true" class="sr-only"><h2>Search</h2><p>Page index: https://rxresu.me/llms.txt.</p><p>${escapeHtml(CONTEXT7_ASK_DESCRIPTION)}</p></blockquote>`;
	const body = html
		.replace("</head>", () => `<meta name="context7-site-verification" content="${verification}"></head>`)
		.replace(/<body\b[^>]*>/i, (tag) => `${tag}${note}`);
	return new Response(body, {
		headers: {
			...headers,
			Link: [headers.Link, ...preloadLinks(template)].filter(Boolean).join(", "),
			// Pages name the current build's assets, so a release purges this tag from Cloudflare's cache
			// (.github/workflows/docker-publish.yml).
			"Cache-Tag": "html",
			"Content-Security-Policy": contentSecurityPolicy(template),
		},
	});
}

const githubUrl = "https://github.com/reactive-resume/reactive-resume";
// The English copy, for a build without prerendered pages; a prerendered page carries its own locale's title and
// description, and the social cards reuse them.
const ROOT_TITLE = "Free resume builder with PDF &amp; Word downloads | Reactive Resume";
const ROOT_DESCRIPTION =
	"Free, open-source resume builder. Create, update, and share your resume, with PDF and Word downloads, no ads and no paywall.";
const ATS_CHECKER_TITLE = "Free ATS resume checker | Reactive Resume";
const ATS_CHECKER_DESCRIPTION =
	"Check whether software can read your resume PDF. Runs entirely in your browser, so your file is never uploaded.";
const TEMPLATES_TITLE = "Free resume templates with PDF examples | Reactive Resume";
const TEMPLATES_DESCRIPTION =
	"Browse free resume templates, compare one-column and two-column layouts, and download sample PDFs. Customize your resume and export to PDF or Word.";

type StructuredData = Record<string, unknown>;

/** Who makes Reactive Resume, referenced by id from every page's structured data. */
function organization(origin: string): StructuredData {
	return {
		"@type": "Organization",
		"@id": `${origin}/#organization`,
		name: "Reactive Resume",
		url: `${origin}/`,
		contactPoint: { "@type": "ContactPoint", contactType: "support", email: "amruth@rxresu.me" },
		logo: { "@type": "ImageObject", url: `${origin}/pwa-512x512.png`, width: 512, height: 512 },
		sameAs: [
			githubUrl,
			"https://www.linkedin.com/company/reactive-resume",
			"https://opencollective.com/reactive-resume",
			"https://www.reddit.com/r/reactiveresume",
			"https://discord.gg/aSyA5ZSxpb",
			"https://crowdin.com/project/reactive-resume",
		],
	};
}

function homepageStructuredData(origin: string): StructuredData {
	const rootUrl = `${origin}/`;
	return {
		"@context": "https://schema.org",
		"@graph": [
			organization(origin),
			{
				"@type": "WebSite",
				"@id": `${origin}/#website`,
				name: "Reactive Resume",
				url: rootUrl,
				publisher: { "@id": `${origin}/#organization` },
			},
			{
				"@type": ["SoftwareApplication", "WebApplication"],
				name: "Reactive Resume",
				url: rootUrl,
				description: ROOT_DESCRIPTION,
				applicationCategory: "BusinessApplication",
				operatingSystem: "Web",
				isAccessibleForFree: true,
				offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
				license: `${githubUrl}/blob/main/LICENSE`,
				publisher: { "@id": `${origin}/#organization` },
				featureList: [
					"Resume editor with a live page preview",
					`${templateSchema.options.length} templates`,
					"PDF, Word (DOCX), Markdown and JSON export",
					"Import from PDF, LinkedIn and JSON Resume, or Word with an AI provider",
					"ATS readability checker",
					"Public or password-protected sharing links",
					"Cover letters and a job application tracker",
					"Optional AI assistant with your own API key",
					"Self-hosting with Docker",
				],
			},
		],
	};
}

function atsCheckerStructuredData(origin: string): StructuredData {
	return {
		"@context": "https://schema.org",
		"@graph": [
			organization(origin),
			{
				"@type": "WebApplication",
				name: "ATS Checker",
				url: `${origin}/ats-checker`,
				description: ATS_CHECKER_DESCRIPTION,
				applicationCategory: "BusinessApplication",
				operatingSystem: "Web",
				isAccessibleForFree: true,
				offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
				isPartOf: { "@type": "WebSite", "@id": `${origin}/#website`, name: "Reactive Resume", url: `${origin}/` },
				provider: { "@id": `${origin}/#organization` },
			},
		],
	};
}

type PageSeoOptions = {
	/** The page's plain address: the canonical for the default locale, and the base of its hreflang alternates. */
	canonicalUrl: string;
	locale: Locale;
	/** A `?locale=` request is canonical for its own language. */
	requested: boolean;
	/** Already HTML-escaped, as the page's own <title> and description are. */
	title: string;
	description: string;
	imageUrl: string;
	structuredData: StructuredData;
};

function createPageSeoMarkup(options: PageSeoOptions) {
	const pageUrl = options.requested ? localizedUrl(options.canonicalUrl, options.locale) : options.canonicalUrl;
	const alternates = getLocaleAlternates(options.canonicalUrl)
		.map(({ hreflang, href }) => `<link rel="alternate" hreflang="${hreflang}" href="${escapeHtml(href)}">`)
		.join("");

	const url = escapeHtml(pageUrl);

	return `
		<link rel="canonical" href="${url}">
		${alternates}
		<meta property="og:locale" content="${options.locale.replace("-", "_")}">
		${socialMetaTags({ type: "website", title: options.title, description: options.description, url, image: options.imageUrl })}
		${jsonLdScript(options.structuredData)}
	`;
}

/** The title and description a page was built with, still HTML-escaped. */
function readPageMeta(html: string, fallback: { title: string; description: string }) {
	return {
		title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? fallback.title,
		description: html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] ?? fallback.description,
	};
}

const mediaFile = /\.(?:avif|gif|ico|jpe?g|mp3|png|svg|ttf|webp|woff2?)$/i;

export const serveWebDistStatic = env.CLOUDFLARE
	? undefined
	: serveStatic({
			root: staticRoot,
			// The Docker build writes brotli copies beside the text files and WASM (tooling/docker/precompress.mjs).
			precompressed: true,
			onFound: (_path, context) => {
				// Vite fingerprints everything under /assets, so a file there never changes.
				if (context.req.path.startsWith("/assets/")) {
					context.header("Cache-Control", "public, max-age=31536000, immutable");
				} else {
					// Other files keep their names when their content changes, so a release purges them from Cloudflare's
					// cache by this tag. Browsers keep pictures, fonts and sounds for 30 days, the shortest lifetime Lighthouse
					// doesn't count as waste; one replaced under the same name reaches every visitor within that month.
					context.header("Cache-Tag", "public");
					if (mediaFile.test(context.req.path)) context.header("Cache-Control", "public, max-age=2592000");
				}
				// `/index.html` is the app shell too; it must not be frameable either.
				if (context.req.path.endsWith(".html"))
					for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) context.header(name, value);
			},
		});

function getFallbackResponseHeaders(pathname: string) {
	if (pathname === "/" || indexableAppPaths.has(pathname)) {
		return { "Content-Type": "text/html; charset=UTF-8", ...BASE_SECURITY_HEADERS };
	}
	if (isAppSectionPath(pathname)) {
		return {
			"Content-Type": "text/html; charset=UTF-8",
			"X-Robots-Tag": "noindex, follow",
			...BASE_SECURITY_HEADERS,
		};
	}

	return null;
}

/** Swaps the page's <title> and description. Function replacers keep `$&`, `$'` etc. in user text literal. */
const withMeta = (html: string, meta: { title: string; description: string }) =>
	html
		.replace(/<title>[^<]*<\/title>/, () => `<title>${meta.title}</title>`)
		.replace(/<meta\s+name="description"[^>]*>/, () => `<meta name="description" content="${meta.description}">`);

/** The indexable pages the web build prerenders, by path. */
const prerenderedPages: Record<
	string,
	{
		name: string;
		meta: { title: string; description: string };
		image: string;
		structuredData: (origin: string) => StructuredData;
	}
> = {
	"/": {
		name: "home",
		meta: { title: ROOT_TITLE, description: ROOT_DESCRIPTION },
		image: "/opengraph/banner.jpg",
		structuredData: homepageStructuredData,
	},
	"/ats-checker": {
		name: "ats-checker",
		meta: { title: ATS_CHECKER_TITLE, description: ATS_CHECKER_DESCRIPTION },
		image: "/opengraph/ats-checker.png",
		structuredData: atsCheckerStructuredData,
	},
	"/resume-templates": {
		name: "resume-templates",
		meta: { title: TEMPLATES_TITLE, description: TEMPLATES_DESCRIPTION },
		image: "/opengraph/banner.jpg",
		structuredData: (origin) => ({
			"@context": "https://schema.org",
			"@type": "CollectionPage",
			name: "Free resume templates",
			url: `${origin}/resume-templates`,
			description: TEMPLATES_DESCRIPTION,
			mainEntity: {
				"@type": "ItemList",
				itemListElement: templateSchema.options.map((template, index) => ({
					"@type": "ListItem",
					position: index + 1,
					name: template.charAt(0).toUpperCase() + template.slice(1),
					url: `${origin}/resume-templates#${template}`,
				})),
			},
		}),
	},
};

export type ReadWebFile = (path: string) => Promise<string>;

export async function handleWebApp(request: Request, readFile: ReadWebFile = (path) => fs.readFile(path, "utf-8")) {
	const requestUrl = new URL(request.url);
	const requestedPath = requestUrl.pathname;
	const pathname = requestedPath === "/index.html" ? "/" : requestedPath;

	if (!isAppSectionPath(pathname) && isAssetPath(pathname)) {
		return new Response("Not Found", { status: 404 });
	}

	// The footer's "Templates" and old links: the gallery lives at /resume-templates. Old per-template previews stay gone.
	if (pathname === "/templates" || pathname === "/templates/")
		return new Response(null, { status: 301, headers: { Location: `/resume-templates${requestUrl.search}` } });

	const headers = getFallbackResponseHeaders(pathname);
	if (!headers)
		return new Response("Not Found", {
			status: 404,
			headers: { "Content-Type": "text/plain; charset=UTF-8", "X-Robots-Tag": "noindex, nofollow" },
		});

	// Hono drops HEAD bodies itself; returning early skips reading the shell and a public resume's DB lookup.
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });

	const html = await readFile(indexHtmlPath);

	const prerendered = prerenderedPages[pathname];
	if (prerendered) {
		const { locale, requested } = getPageLocale(request) ?? { locale: defaultLocale, requested: false };
		const origin = new URL(env.APP_URL).origin;
		// Without a prerendered page (a build that skipped it), the app shell titled for the page renders it in the browser.
		const page = await readFile(`${prerenderRoot}/${prerendered.name}/${locale}.html`).catch(() =>
			withMeta(html, prerendered.meta),
		);
		const markup = createPageSeoMarkup({
			canonicalUrl: new URL(pathname, env.APP_URL).toString(),
			locale,
			requested,
			...readPageMeta(page, prerendered.meta),
			imageUrl: `${origin}${prerendered.image}`,
			structuredData: prerendered.structuredData(origin),
		});
		const body =
			pathname === "/"
				? page.replace(/href="\/\?locale=([^"#&]+)#languages"/g, (_match, language: string) => {
						const search = new URLSearchParams(requestUrl.search);
						search.set("locale", language);
						return `href="/?${escapeHtml(search.toString())}#languages"`;
					})
				: page;

		// The saved locale changes what this address shows, so caches have to key on the cookie.
		return htmlResponse(
			body.replace("</head>", () => `${markup}</head>`),
			{ ...headers, Vary: "Cookie" },
			page,
		);
	}

	return htmlResponse(html, headers);
}
