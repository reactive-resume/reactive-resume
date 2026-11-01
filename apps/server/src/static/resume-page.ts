import type { ResumeMatch } from "@reactive-resume/api/features/resume/web-page";
import type { ResumeWebPage } from "@reactive-resume/pdf/web-page";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createHash } from "node:crypto";
import { loadPublicWebPage, verifyWebPagePassword } from "@reactive-resume/api/features/resume/web-page";
import { env } from "@reactive-resume/env/server";
import { renderResumeWebPage, webPageImageUrl } from "@reactive-resume/pdf/web-page";
import {
	localeFromAcceptLanguage,
	renderPasswordDocument,
	renderUnavailableDocument,
	renderWebPageDocument,
	WEB_PAGE_SCRIPT,
	webPageMessages,
} from "@reactive-resume/pdf/web-page-document";
import { publicResumePath } from "@reactive-resume/resume/sharing";
import { getResumeSocialMeta } from "@reactive-resume/resume/social-meta";
import { BASE_SECURITY_HEADERS, contentSecurityPolicy } from "./web";

const origin = () => new URL(env.APP_URL).origin;

function html(body: string, status: number, headers: Record<string, string> = {}) {
	return new Response(body, {
		status,
		headers: {
			...BASE_SECURITY_HEADERS,
			"Content-Type": "text/html; charset=UTF-8",
			// Views are counted per request and the page follows every edit, so no cache may keep it.
			"Cache-Control": "private, no-store",
			"Content-Security-Policy": contentSecurityPolicy(`<script>${WEB_PAGE_SCRIPT}</script>`),
			...headers,
		},
	});
}

// Rendered sheets by the content they draw (already redacted), so repeat visits skip React, HTML and CSS.
// ponytail: per process, cleared at 100 entries; a shared cache if renders show up under load.
const rendered = new Map<string, ResumeWebPage>();

async function renderSheet(data: ResumeData) {
	const key = createHash("sha256").update(JSON.stringify(data)).digest("hex");
	const hit = rendered.get(key);
	if (hit) return hit;
	const page = await renderResumeWebPage({ data, imageUrl: webPageImageUrl(origin()) });
	if (rendered.size >= 100) rendered.clear();
	rendered.set(key, page);
	return page;
}

/** The resume as a person, for search engines: who it is, what they do, and where else they're found. */
function structuredData(data: ResumeData, url: string, updatedAt: Date) {
	const sameAs = [data.basics.website.url, ...data.sections.profiles.items.map((item) => item.website.url)].filter(
		(link) => /^https?:\/\//i.test(link),
	);
	const image = data.picture.url ? webPageImageUrl(origin())(data.picture.url) : undefined;
	return {
		"@context": "https://schema.org",
		"@type": "ProfilePage",
		url,
		dateModified: updatedAt.toISOString(),
		mainEntity: {
			"@type": "Person",
			name: data.basics.name,
			...(data.basics.headline ? { jobTitle: data.basics.headline } : {}),
			...(data.basics.location ? { homeLocation: { "@type": "Place", name: data.basics.location } } : {}),
			...(image && !image.startsWith("data:") ? { image } : {}),
			...(sameAs.length > 0 ? { sameAs } : {}),
		},
	};
}

type PageOptions = {
	/** Set on a custom domain: the page lives at its root there. */
	customDomain?: string | undefined;
};

/** Off, unknown or trashed resumes read the same, in the visitor's language. */
function unavailableResponse(request: Request) {
	const lang = localeFromAcceptLanguage(request.headers.get("accept-language"));
	return html(renderUnavailableDocument({ lang, messages: webPageMessages(lang), homeUrl: `${origin()}/` }), 404);
}

/**
 * A resume's web page, wherever it's served: `/<username>/<slug>`, `/<username>` (the primary resume), the instance's
 * root (`ROOT_RESUME_ID`, matched by ID) or a custom domain. GET shows the page, its password form, or the page saying
 * it isn't shared; POST is the password form, whose success sets the access cookie and shows the page.
 */
export function serveResumePage(
	request: Request,
	match: ResumeMatch,
	trustedClient: string,
	options: PageOptions = {},
): Promise<Response> {
	return request.method === "POST"
		? submitPassword(request, match, trustedClient, options)
		: showPage(request, match, trustedClient, options);
}

async function showPage(request: Request, match: ResumeMatch, trustedClient: string, options: PageOptions) {
	const previewToken = new URL(request.url).searchParams.get("preview") ?? undefined;
	const result = await loadPublicWebPage({ match, requestHeaders: request.headers, trustedClient, previewToken });

	if (result.status === "unavailable") return unavailableResponse(request);
	if (result.status === "moved") {
		const target = new URL(request.url);
		target.pathname = publicResumePath({ username: result.username, slug: result.slug });
		return new Response(null, { status: 301, headers: { Location: `${target.pathname}${target.search}` } });
	}
	if (result.status === "password") {
		const lang = result.locale;
		const wrongPassword = new URL(request.url).searchParams.has("wrong-password");
		return html(renderPasswordDocument({ lang, messages: webPageMessages(lang), wrongPassword }), 401);
	}

	const { data } = result;
	const page = await renderSheet(data);
	const own = publicResumePath({ username: result.username, slug: result.slug });
	// One address for search engines, whichever domain or path served it: the custom domain, the root, the primary
	// resume's `/<username>`, or its own address, always on APP_URL.
	const domain = options.customDomain ?? result.customDomain;
	const canonicalUrl = domain
		? `https://${domain}/`
		: "id" in match
			? `${origin()}/`
			: `${origin()}${publicResumePath(result)}`;
	const social = getResumeSocialMeta(data);

	const body = renderWebPageDocument({
		page,
		messages: webPageMessages(data.metadata.page.locale),
		head: {
			title: social.title,
			description: social.description,
			canonicalUrl,
			indexable: result.indexable,
			// Password-protected pages show the generic banner; the card itself refuses them too.
			imageUrl: result.hasPassword ? `${origin()}/opengraph/banner.jpg` : `${origin()}/cards${own}.png`,
			structuredData: result.indexable ? structuredData(data, canonicalUrl, result.updatedAt) : undefined,
		},
		downloadUrl: result.showDownloadButtons ? `/api/resumes${own}/pdf?download` : undefined,
		creditUrl: data.metadata.web?.showCredit === false ? undefined : origin(),
	});
	return html(
		body,
		200,
		result.indexable ? {} : { "X-Robots-Tag": previewToken ? "noindex, nofollow" : "noindex, follow" },
	);
}

// The password form is one short field. Checked here, not by the route, because a custom domain's page is served by
// middleware that runs before any route's body limit.
const MAX_FORM_BYTES = 16 * 1024;

async function submitPassword(request: Request, match: ResumeMatch, trustedClient: string, options: PageOptions) {
	const length = request.headers.get("content-length");
	if (length === null || !(Number(length) <= MAX_FORM_BYTES))
		return new Response("Payload Too Large", { status: 413, headers: { "Cache-Control": "no-store" } });
	const form = await request.formData().catch(() => null);
	const password = form?.get("password");
	const responseHeaders = new Headers();
	const valid =
		typeof password === "string" && (await verifyWebPagePassword({ match, password, trustedClient, responseHeaders }));

	// Back to where the form was served.
	const page =
		options.customDomain || "id" in match
			? "/"
			: publicResumePath({ slug: "", ...match, isPrimary: "primary" in match });
	responseHeaders.set("Location", valid ? page : `${page}?wrong-password`);
	responseHeaders.set("Cache-Control", "no-store");
	return new Response(null, { status: 303, headers: responseHeaders });
}
