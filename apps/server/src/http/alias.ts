import { env } from "@reactive-resume/env/server";
import { isAppSectionPath } from "@reactive-resume/utils/app-paths";

// Host and port: in development both domains can be localhost on different ports.
const aliasHost = env.APP_ALIAS_URL ? new URL(env.APP_ALIAS_URL).host : undefined;
const appOrigin = new URL(env.APP_URL).origin;

/**
 * The same path and query on `APP_URL`. Joined as text, not resolved as a URL: a path such as `//evil.example` would
 * otherwise replace the host and make the redirect an open one.
 */
export const onAppDomain = (url: URL) => `${appOrigin}${url.pathname}${url.search}`;

/**
 * The alias domain (`APP_ALIAS_URL`) serves the same public pages as `APP_URL`: resumes, `/<username>`, the home and
 * marketing pages, and the API they call. Signing in and the editor live on `APP_URL` alone (login cookies, passkeys
 * and social sign-in belong to one domain), so on the alias those sections move there. Search engines are pointed at
 * `APP_URL` by each page's canonical address. Other hosts and paths are left alone.
 */
export function handleAlias(request: Request): Response | null {
	if (!aliasHost) return null;
	const url = new URL(request.url);
	if (url.host !== aliasHost || !isAppSectionPath(url.pathname)) return null;
	return Response.redirect(onAppDomain(url), 301);
}
