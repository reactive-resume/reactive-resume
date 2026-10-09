import type { Locale } from "@reactive-resume/utils/locale";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { env } from "@reactive-resume/env/server";
import { templateSchema } from "@reactive-resume/schema/templates";
import { defaultLocale, getLocaleAlternates, isLocale, localizedUrl } from "@reactive-resume/utils/locale";

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
const noindexShellPrefixes = ["/auth", "/dashboard", "/builder", "/agent", "/templates"];
/**
 * Marketing pages the SPA owns that search engines should index.
 *
 * Without an entry here the fallback below returns 404 for the path in production — the dev Vite
 * server serves the shell for anything, so this failure only ever shows up once deployed.
 */
const indexableAppPaths = new Set(["/ats-checker"]);
const reservedPublicResumeSegments = new Set([
	"api",
	"mcp",
	".well-known",
	"uploads",
	"auth",
	"dashboard",
	"builder",
	"agent",
	"templates",
	"ats-checker",
]);

function isAssetPath(pathname: string): boolean {
	return pathname.split("/").pop()?.includes(".") ?? false;
}

function getPathSegments(pathname: string) {
	return pathname.split("/").filter(Boolean);
}

function isNoindexShellPath(pathname: string): boolean {
	return noindexShellPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPublicResumePath(pathname: string): boolean {
	const segments = getPathSegments(pathname);
	const [firstSegment] = segments;

	return segments.length === 2 && firstSegment !== undefined && !reservedPublicResumeSegments.has(firstSegment);
}

const BASE_SECURITY_HEADERS = {
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	// `wasm-unsafe-eval` lets the PDF engine (Forme, WebAssembly) start in the browser.
	"Content-Security-Policy-Report-Only":
		"default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

const githubUrl = "https://github.com/reactive-resume/reactive-resume";
// The English copy, for a build without prerendered pages; a prerendered page carries its own locale's title and
// description, and the social cards reuse them.
const ROOT_TITLE = "Reactive Resume — A free and open-source resume builder";
const ROOT_DESCRIPTION =
	"Free, open-source resume builder. Create, update, and share your resume, with PDF and Word downloads, no ads and no paywall.";
const ATS_CHECKER_TITLE = "Free ATS resume checker — Reactive Resume";
const ATS_CHECKER_DESCRIPTION =
	"Check whether software can read your resume PDF. Runs entirely in your browser, so your file is never uploaded.";

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
				codeRepository: githubUrl,
				publisher: { "@id": `${origin}/#organization` },
				featureList: [
					"Resume editor with a live page preview",
					`${templateSchema.options.length} templates`,
					"PDF, Word (DOCX), Markdown and JSON export",
					"Import from PDF, LinkedIn, JSON Resume and Word",
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
		.map(({ hreflang, href }) => `<link rel="alternate" hreflang="${hreflang}" href="${escapeAttribute(href)}">`)
		.join("");

	return `
		<link rel="canonical" href="${escapeAttribute(pageUrl)}">
		${alternates}
		<meta property="og:type" content="website">
		<meta property="og:site_name" content="Reactive Resume">
		<meta property="og:locale" content="${options.locale.replace("-", "_")}">
		<meta property="og:title" content="${options.title}">
		<meta property="og:description" content="${options.description}">
		<meta property="og:url" content="${escapeAttribute(pageUrl)}">
		<meta property="og:image" content="${options.imageUrl}">
		<meta name="twitter:card" content="summary_large_image">
		<meta name="twitter:title" content="${options.title}">
		<meta name="twitter:description" content="${options.description}">
		<meta name="twitter:image" content="${options.imageUrl}">
		<script type="application/ld+json">${JSON.stringify(options.structuredData)}</script>
	`;
}

/** The title and description a page was built with, still HTML-escaped. */
function readPageMeta(html: string, fallback: { title: string; description: string }) {
	return {
		title: html.match(/<title>([^<]*)<\/title>/)?.[1] ?? fallback.title,
		description: html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] ?? fallback.description,
	};
}

// Resume names, headlines, and summaries are user-authored, so they must never reach the served
// HTML unescaped.
const escapeAttribute = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

async function createPublicResumeSeoMarkup(pathname: string, origin: string) {
	const [username, slug] = getPathSegments(pathname);
	if (!username || !slug) return null;

	// A card render must never take down the page: any lookup failure falls back to the plain shell.
	const meta = await import("@reactive-resume/api/features/resume/social-meta")
		.then((module) => module.getPublicResumeSocialMeta({ username, slug }))
		.catch(() => null);
	if (!meta) return null;

	const canonicalUrl = `${origin}/${username}/${slug}`;
	const imageUrl = `${origin}/opengraph/banner.jpg`;
	const pageTitle = escapeAttribute(`${meta.name} - Reactive Resume`);
	const title = escapeAttribute(meta.title);
	const description = escapeAttribute(meta.description);

	return {
		pageTitle,
		description,
		markup: `
		<link rel="canonical" href="${canonicalUrl}">
		<meta property="og:type" content="profile">
		<meta property="og:site_name" content="Reactive Resume">
		<meta property="og:title" content="${title}">
		<meta property="og:description" content="${description}">
		<meta property="og:url" content="${canonicalUrl}">
		<meta property="og:image" content="${imageUrl}">
		<meta name="twitter:card" content="summary_large_image">
		<meta name="twitter:title" content="${title}">
		<meta name="twitter:description" content="${description}">
		<meta name="twitter:image" content="${imageUrl}">
	`,
	};
}

export const serveWebDistStatic = env.CLOUDFLARE
	? undefined
	: serveStatic({
			root: staticRoot,
			onFound: (_path, context) => {
				// Vite fingerprints everything under /assets, so a file there never changes.
				if (context.req.path.startsWith("/assets/") || /^\/videos\/.*-v\d+\.(?:mp4|webp)$/.test(context.req.path)) {
					context.header("Cache-Control", "public, max-age=31536000, immutable");
				}
			},
		});

function getFallbackResponseHeaders(pathname: string) {
	if (pathname === "/" && env.ROOT_RESUME_ID) {
		return {
			"Content-Type": "text/html; charset=UTF-8",
			"X-Robots-Tag": "noindex, follow",
			"Cache-Control": "private, no-store",
			...BASE_SECURITY_HEADERS,
		};
	}
	if (pathname === "/" || indexableAppPaths.has(pathname)) {
		return { "Content-Type": "text/html; charset=UTF-8", ...BASE_SECURITY_HEADERS };
	}
	if (isNoindexShellPath(pathname) || isPublicResumePath(pathname)) {
		return {
			"Content-Type": "text/html; charset=UTF-8",
			"X-Robots-Tag": "noindex, follow",
			...BASE_SECURITY_HEADERS,
		};
	}

	return null;
}

/**
 * A prerendered page's language: a `?locale=` address first (its hreflang alternates), then the visitor's saved
 * choice, in the order the app reads them (apps/web/src/libs/locale.ts).
 */
function getPageLocale(request: Request) {
	const requested = new URL(request.url).searchParams.get("locale");
	if (isLocale(requested)) return { locale: requested, requested: true };

	const saved = request.headers.get("cookie")?.match(/(?:^|;\s*)locale=([^;]*)/)?.[1] ?? "";
	return { locale: isLocale(saved) ? saved : defaultLocale, requested: false };
}

function notFoundResponse(options: { head?: boolean; noindex?: boolean } = {}) {
	const headers = new Headers({ "Content-Type": "text/plain; charset=UTF-8" });
	if (options.noindex) headers.set("X-Robots-Tag", "noindex, nofollow");

	return new Response(options.head ? null : "Not Found", {
		status: 404,
		headers,
	});
}

const withMeta = (html: string, meta: { title: string; description: string }) =>
	html
		.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`)
		.replace(/<meta\s+name="description"[^>]*>/, `<meta name="description" content="${meta.description}">`);

/** The indexable pages the web build prerenders, by path. */
const prerenderedPages: Record<
	string,
	{
		name: string;
		meta: { title: string; description: string };
		image: string;
		structuredData: (origin: string) => StructuredData;
		/** The page when the build has no prerendered copy: the app shell, titled for the page. */
		fallback: (shell: string) => string;
	}
> = {
	"/": {
		name: "home",
		meta: { title: ROOT_TITLE, description: ROOT_DESCRIPTION },
		image: "/opengraph/banner.jpg",
		structuredData: homepageStructuredData,
		fallback: (shell) => shell,
	},
	"/ats-checker": {
		name: "ats-checker",
		meta: { title: ATS_CHECKER_TITLE, description: ATS_CHECKER_DESCRIPTION },
		image: "/opengraph/ats-checker.png",
		structuredData: atsCheckerStructuredData,
		fallback: (shell) => withMeta(shell, { title: ATS_CHECKER_TITLE, description: ATS_CHECKER_DESCRIPTION }),
	},
};

// ponytail: GET and HEAD share the same routing logic; method determines body presence
export type ReadWebFile = (path: string) => Promise<string>;

export async function handleWebApp(request: Request, readFile: ReadWebFile = (path) => fs.readFile(path, "utf-8")) {
	const isHead = request.method === "HEAD";
	const pathname = new URL(request.url).pathname;

	if (!isNoindexShellPath(pathname) && isAssetPath(pathname)) {
		return new Response(isHead ? null : "Not Found", { status: 404 });
	}

	const headers = getFallbackResponseHeaders(pathname);
	if (!headers) return notFoundResponse({ head: isHead, noindex: true });

	if (isHead) return new Response(null, { status: 200, headers });

	const html = await readFile(indexHtmlPath);

	if (pathname === "/" && env.ROOT_RESUME_ID) {
		const canonicalUrl = new URL("/", env.APP_URL).toString();
		// Root configuration never discloses a target in the HTML shell. The public API
		// gates data and browser metadata; shell requests must not count extra views.
		const shell = html
			.replace(/<title>[^<]*<\/title>/, "<title>Reactive Resume</title>")
			.replace(/<meta\s+name="description"[^>]*>/, '<meta name="description" content="">');
		const markup = `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" data-root-resume-shell><meta name="robots" content="noindex, follow" data-root-resume-shell>`;
		return new Response(
			shell.replace("</head>", () => `${markup}</head>`),
			{ headers },
		);
	}

	const prerendered = prerenderedPages[pathname];
	if (prerendered) {
		const { locale, requested } = getPageLocale(request);
		const origin = new URL(env.APP_URL).origin;
		// Without a prerendered page (a build that skipped it), the app renders the page in the browser.
		const page = await readFile(`${prerenderRoot}/${prerendered.name}/${locale}.html`).catch(() =>
			prerendered.fallback(html),
		);
		const markup = createPageSeoMarkup({
			canonicalUrl: new URL(pathname, env.APP_URL).toString(),
			locale,
			requested,
			...readPageMeta(page, prerendered.meta),
			imageUrl: `${origin}${prerendered.image}`,
			structuredData: prerendered.structuredData(origin),
		});

		// The saved locale changes what this address shows, so caches have to key on the cookie.
		return new Response(
			page.replace("</head>", () => `${markup}</head>`),
			{ headers: { ...headers, Vary: "Cookie" } },
		);
	}

	if (isPublicResumePath(pathname)) {
		const resumeSeo = await createPublicResumeSeoMarkup(pathname, new URL(env.APP_URL).origin);
		if (resumeSeo) {
			// The shell's generic title/description are replaced so shares and previews show the resume,
			// not the marketing copy baked into index.html. Function replacers keep `$&`, `$'` etc. in user text literal.
			const withTitle = html
				.replace(/<title>[^<]*<\/title>/, () => `<title>${resumeSeo.pageTitle}</title>`)
				.replace(
					/<meta\s+name="description"[^>]*>/,
					() => `<meta name="description" content="${resumeSeo.description}">`,
				);

			return new Response(
				withTitle.replace("</head>", () => `${resumeSeo.markup}</head>`),
				{ headers },
			);
		}
	}

	return new Response(html, { headers });
}
