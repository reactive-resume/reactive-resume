import type { ResumeData } from "@reactive-resume/schema/resume/data";
import {
	findResumeAddress,
	loadPublicWebPage,
	verifyWebPagePassword,
} from "@reactive-resume/api/features/resume/web-page";
import { env } from "@reactive-resume/env/server";
import { renderResumeWebPage } from "@reactive-resume/pdf/web-page";
import {
	localeFromAcceptLanguage,
	renderPasswordDocument,
	renderUnavailableDocument,
	renderWebPageDocument,
	webPageMessages,
} from "@reactive-resume/pdf/web-page-document";
import { getResumeSocialMeta } from "@reactive-resume/resume/social-meta";
import { isRTL } from "@reactive-resume/utils/locale";
import { BASE_SECURITY_HEADERS, contentSecurityPolicy } from "./web";

type ResumeAddress = { username: string; slug: string };

const origin = () => new URL(env.APP_URL).origin;

const path = ({ username, slug }: ResumeAddress) => `/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`;

function html(body: string, status: number, headers: Record<string, string> = {}) {
	return new Response(body, {
		status,
		headers: {
			...BASE_SECURITY_HEADERS,
			"Content-Type": "text/html; charset=UTF-8",
			// Views are counted per request and the page follows every edit, so no cache may keep it.
			"Cache-Control": "private, no-store",
			"Content-Security-Policy": contentSecurityPolicy(body),
			...headers,
		},
	});
}

/** A picture on the page: uploads load from the app, wherever the page is served; other pictures as given. */
const imageUrl = (source: string) => {
	if (source.startsWith("/")) return `${origin()}${source}`;
	return /^(https?:|data:image\/)/i.test(source) ? source : undefined;
};

/** The resume as a person, for search engines: who it is, what they do, and where else they're found. */
function structuredData(data: ResumeData, url: string, updatedAt: Date) {
	const sameAs = [data.basics.website.url, ...data.sections.profiles.items.map((item) => item.website.url)].filter(
		(link) => /^https?:\/\//i.test(link),
	);
	const image = data.picture.url ? imageUrl(data.picture.url) : undefined;
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
	/** Set for the instance's root resume (`ROOT_RESUME_ID`): the page lives at the app's root. */
	root?: boolean | undefined;
};

/** Where the page is served, for the password form's redirect. */
const pagePath = (address: ResumeAddress, options: PageOptions) =>
	options.customDomain || options.root ? "/" : path(address);

/** Off, unknown or trashed resumes read the same, in the visitor's language. */
export function unavailableResponse(request: Request) {
	const lang = localeFromAcceptLanguage(request.headers.get("accept-language"));
	return html(renderUnavailableDocument({ lang, messages: webPageMessages(lang) }), 404);
}

/** `GET /<username>/<slug>`: the resume's web page, its password form, or the page saying it isn't shared. */
export async function handleResumeWebPage(
	request: Request,
	address: ResumeAddress,
	trustedClient: string,
	options: PageOptions = {},
) {
	const previewToken = new URL(request.url).searchParams.get("preview") ?? undefined;
	const result = await loadPublicWebPage({ ...address, requestHeaders: request.headers, trustedClient, previewToken });

	if (result.status === "unavailable") return unavailableResponse(request);
	if (result.status === "moved") {
		const target = new URL(request.url);
		target.pathname = path({ ...address, slug: result.slug });
		return new Response(null, { status: 301, headers: { Location: `${target.pathname}${target.search}` } });
	}
	if (result.status === "password") {
		const lang = result.locale;
		const wrongPassword = new URL(request.url).searchParams.has("wrong-password");
		const dir = isRTL(lang as Parameters<typeof isRTL>[0]) ? "rtl" : "ltr";
		return html(renderPasswordDocument({ lang, dir, messages: webPageMessages(lang), wrongPassword }), 401);
	}

	const { data, settings } = result;
	const page = await renderResumeWebPage({ data, imageUrl });
	const domain = options.customDomain ?? result.customDomain;
	const canonicalUrl = domain
		? `https://${domain}/`
		: options.root
			? `${origin()}/`
			: `${origin()}${path({ ...address, slug: result.slug })}`;
	const social = getResumeSocialMeta(data);
	const indexable = settings.showInSearchEngines && !settings.hasPassword;
	const api = `/api/resumes${path({ ...address, slug: result.slug })}`;

	const body = renderWebPageDocument({
		page,
		messages: webPageMessages(data.metadata.page.locale),
		head: {
			title: social.title,
			description: social.description,
			canonicalUrl,
			indexable,
			// Password-protected pages show the generic banner; the card itself refuses them too.
			imageUrl: settings.hasPassword
				? `${origin()}/opengraph/banner.jpg`
				: `${origin()}/cards${path({ ...address, slug: result.slug })}.png`,
			structuredData: indexable ? structuredData(data, canonicalUrl, result.updatedAt) : undefined,
		},
		downloadUrl: settings.showDownloadButtons ? `${api}/pdf?download` : undefined,
		contactUrl: settings.hideContactDetails && settings.showContactButton ? `${api}/contact` : undefined,
		creditUrl: data.metadata.web?.showCredit === false ? undefined : origin(),
	});
	return html(body, 200, indexable ? {} : { "X-Robots-Tag": previewToken ? "noindex, nofollow" : "noindex, follow" });
}

/** `POST /<username>/<slug>`: the password form. Success sets the access cookie and shows the page. */
export async function handleResumeWebPagePassword(
	request: Request,
	address: ResumeAddress,
	trustedClient: string,
	options: PageOptions = {},
) {
	const form = await request.formData().catch(() => null);
	const password = form?.get("password");
	const responseHeaders = new Headers();
	const valid =
		typeof password === "string" &&
		(await verifyWebPagePassword({ ...address, password, trustedClient, responseHeaders }));

	const page = pagePath(address, options);
	responseHeaders.set("Location", valid ? page : `${page}?wrong-password`);
	responseHeaders.set("Cache-Control", "no-store");
	return new Response(null, { status: 303, headers: responseHeaders });
}

/**
 * `/` on an instance with `ROOT_RESUME_ID`: that resume's web page, or the page saying it isn't shared. The
 * configuration is the only authority; nothing in the request picks the resume.
 */
export async function handleRootResume(request: Request, trustedClient: string) {
	const id = env.ROOT_RESUME_ID;
	const address = id ? await findResumeAddress(id) : null;
	if (!address) return unavailableResponse(request);
	if (request.method === "POST") return handleResumeWebPagePassword(request, address, trustedClient, { root: true });
	return handleResumeWebPage(request, address, trustedClient, { root: true });
}
