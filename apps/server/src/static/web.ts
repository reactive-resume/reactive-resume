import type { Locale } from "@reactive-resume/utils/locale";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { env } from "@reactive-resume/env/server";
import { templateSchema } from "@reactive-resume/schema/templates";
import { defaultLocale, getLocaleAlternates, isLocale, localizedUrl } from "@reactive-resume/utils/locale";
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
const noindexShellPrefixes = ["/auth", "/dashboard", "/builder", "/agent"];
/**
 * Marketing pages the SPA owns that search engines should index.
 *
 * Without an entry here the fallback below returns 404 for the path in production — the dev Vite
 * server serves the shell for anything, so this failure only ever shows up once deployed.
 */
const indexableAppPaths = new Set(["/ats-checker", "/resume-templates"]);
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
	"resume-templates",
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

/**
 * Scripts run only from the app's own files and the inline scripts of the page served, allowed by hash; `wasm-unsafe-eval`
 * lets the PDF engine (Forme, WebAssembly) start. Pictures, avatars and fonts can live on any https host (a resume's
 * picture URL, a sign-in provider's avatar) and the PDF engine fetches them, so images, fonts and connections stay open
 * to https. Recordings, previews and workers use blob: URLs.
 */
function contentSecurityPolicy(html = "") {
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
		["script-src 'self' 'wasm-unsafe-eval'", ...hashes].join(" "),
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

const BASE_SECURITY_HEADERS = {
	Link: `<${CONTEXT7_ASK_URL}>; rel="search"; type="text/plain"; title="Search rxresu.me"`,
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Content-Security-Policy": contentSecurityPolicy(),
};

/**
 * An HTML page whose policy allows exactly the inline scripts of its template. Hashes come from the template before
 * any resume-derived markup goes in, so text that slipped past escaping could never allow itself.
 */
function htmlResponse(html: string, headers: Record<string, string>, template = html) {
	const verification = new URL(CONTEXT7_ASK_URL).searchParams.get("siteKey") ?? "";
	const note = `<blockquote data-context7-ask="true" aria-hidden="true" class="sr-only"><h2>Search</h2><p>Page index: https://rxresu.me/llms.txt.</p><p>${escapeAttribute(CONTEXT7_ASK_DESCRIPTION)}</p></blockquote>`;
	const body = html
		.replace("</head>", () => `<meta name="context7-site-verification" content="${verification}"></head>`)
		.replace(/<body\b[^>]*>/i, (tag) => `${tag}${note}`);
	return new Response(body, { headers: { ...headers, "Content-Security-Policy": contentSecurityPolicy(template) } });
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
		.map(({ hreflang, href }) => `<link rel="alternate" hreflang="${hreflang}" href="${escapeAttribute(href)}">`)
		.join("");

	const url = escapeAttribute(pageUrl);

	return `
		<link rel="canonical" href="${url}">
		${alternates}
		<meta property="og:locale" content="${options.locale.replace("-", "_")}">
		${socialTags({ type: "website", title: options.title, description: options.description, url, image: options.imageUrl })}
		<script type="application/ld+json">${JSON.stringify(options.structuredData).replaceAll("<", "\\u003c")}</script>
	`;
}

/** OpenGraph and Twitter card tags. Every value must already be HTML-escaped. */
function socialTags(tags: { type: string; title: string; description: string; url: string; image: string }) {
	return `<meta property="og:type" content="${tags.type}">
		<meta property="og:site_name" content="Reactive Resume">
		<meta property="og:title" content="${tags.title}">
		<meta property="og:description" content="${tags.description}">
		<meta property="og:url" content="${tags.url}">
		<meta property="og:image" content="${tags.image}">
		<meta name="twitter:card" content="summary_large_image">
		<meta name="twitter:title" content="${tags.title}">
		<meta name="twitter:description" content="${tags.description}">
		<meta name="twitter:image" content="${tags.image}">`;
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

	const canonicalUrl = escapeAttribute(`${origin}/${username}/${slug}`);
	// Wider screens show the server's PDF (apps/web public-pdf.ts): start it with the HTML, not after the app boots.
	// The href is the one the app fetches, so the browser hands the app this response instead of asking again.
	const pdfUrl = escapeAttribute(`/api/resumes/${reencode(username)}/${reencode(slug)}/pdf`);
	const description = escapeAttribute(meta.description);
	const social = socialTags({
		type: "profile",
		title: escapeAttribute(meta.title),
		description,
		url: canonicalUrl,
		image: `${origin}/opengraph/banner.jpg`,
	});

	return {
		pageTitle: escapeAttribute(`${meta.name} - Reactive Resume`),
		description,
		markup: `
		<link rel="canonical" href="${canonicalUrl}">
		${social}
		<link rel="preload" href="${pdfUrl}" as="fetch" crossorigin="use-credentials" media="(min-width: 640px)">
	`,
	};
}

/** A path segment as the app's router decodes it and `encodeURIComponent` writes it back. */
function reencode(segment: string) {
	try {
		return encodeURIComponent(decodeURIComponent(segment));
	} catch {
		return encodeURIComponent(segment);
	}
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
				// `/index.html` is the app shell too; it must not be frameable either.
				if (context.req.path.endsWith(".html"))
					for (const [name, value] of Object.entries(BASE_SECURITY_HEADERS)) context.header(name, value);
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
	const requestedPath = new URL(request.url).pathname;
	const pathname = requestedPath === "/index.html" ? "/" : requestedPath;

	if (!isNoindexShellPath(pathname) && isAssetPath(pathname)) {
		return new Response("Not Found", { status: 404 });
	}

	const headers = getFallbackResponseHeaders(pathname);
	if (!headers)
		return new Response("Not Found", {
			status: 404,
			headers: { "Content-Type": "text/plain; charset=UTF-8", "X-Robots-Tag": "noindex, nofollow" },
		});

	// Hono drops HEAD bodies itself; returning early skips reading the shell and a public resume's DB lookup.
	if (request.method === "HEAD") return new Response(null, { status: 200, headers });

	const html = await readFile(indexHtmlPath);

	if (pathname === "/" && env.ROOT_RESUME_ID) {
		const canonicalUrl = new URL("/", env.APP_URL).toString();
		// Root configuration never discloses a target in the HTML shell. The public API
		// gates data and browser metadata; shell requests must not count extra views.
		const shell = withMeta(html, { title: "Reactive Resume", description: "" });
		const markup = `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" data-root-resume-shell><meta name="robots" content="noindex, follow" data-root-resume-shell>`;
		return htmlResponse(
			shell.replace("</head>", () => `${markup}</head>`),
			headers,
			html,
		);
	}

	const prerendered = prerenderedPages[pathname];
	if (prerendered) {
		const { locale, requested } = getPageLocale(request);
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

		// The saved locale changes what this address shows, so caches have to key on the cookie.
		return htmlResponse(
			page.replace("</head>", () => `${markup}</head>`),
			{ ...headers, Vary: "Cookie" },
			page,
		);
	}

	if (isPublicResumePath(pathname)) {
		const resumeSeo = await createPublicResumeSeoMarkup(pathname, new URL(env.APP_URL).origin);
		if (resumeSeo) {
			// The shell's generic title/description are replaced so shares and previews show the resume,
			// not the marketing copy baked into index.html.
			const withTitle = withMeta(html, { title: resumeSeo.pageTitle, description: resumeSeo.description });

			return htmlResponse(
				withTitle.replace("</head>", () => `${resumeSeo.markup}</head>`),
				headers,
				html,
			);
		}
	}

	return htmlResponse(html, headers);
}
