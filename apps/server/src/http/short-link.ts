import { findPrimaryResume } from "@reactive-resume/api/features/resume/web-page";
import { env } from "@reactive-resume/env/server";
import { unavailableResponse } from "../static/resume-page";

/** The short domain's host, when one is configured. */
export const shortLinkHost = env.SHORT_LINK_URL ? new URL(env.SHORT_LINK_URL).host.toLowerCase() : undefined;

/**
 * The short domain only redirects: `/<username>` to that account's primary resume (302, since the primary can
 * change and browsers keep 301s), and every other address, `/` included, to the same address on the app (301), so
 * search engines rank the app's domain.
 */
export async function handleShortLink(request: Request): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/robots.txt") {
		return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain; charset=UTF-8" } });
	}

	const segments = url.pathname.split("/").filter(Boolean);
	const [segment] = segments;
	if (segments.length !== 1 || !segment) {
		return Response.redirect(new URL(`${url.pathname}${url.search}`, env.APP_URL), 301);
	}

	let username: string;
	try {
		username = decodeURIComponent(segment);
	} catch {
		username = segment;
	}
	const primary = await findPrimaryResume(username);
	if (primary?.isPublic) {
		const target = new URL(
			`/${encodeURIComponent(username.toLowerCase())}/${encodeURIComponent(primary.slug)}`,
			env.APP_URL,
		);
		target.search = url.search;
		return new Response(null, { status: 302, headers: { Location: target.href, "Cache-Control": "no-store" } });
	}

	return unavailableResponse(request);
}
