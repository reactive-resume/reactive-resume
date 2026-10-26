import { timingSafeEqual } from "node:crypto";
import {
	isCustomDomainsEnabled,
	resumeForCustomDomain,
	traefikConfiguration,
} from "@reactive-resume/api/features/custom-domain";
import { env } from "@reactive-resume/env/server";
import { handleResumeWebPage, handleResumeWebPagePassword, unavailableResponse } from "../static/resume-page";

type Target = Awaited<ReturnType<typeof resumeForCustomDomain>>;

// Hosts seen recently and what they open; a minute is how long a new verification or primary takes to show.
const cache = new Map<string, { target: Target; expires: number }>();
const CACHE_MS = 60_000;
const CACHE_LIMIT = 5_000;

async function targetOf(hostname: string): Promise<Target> {
	const hit = cache.get(hostname);
	if (hit && hit.expires > Date.now()) return hit.target;
	const target = await resumeForCustomDomain(hostname);
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(hostname, { target, expires: Date.now() + CACHE_MS });
	return target;
}

const appHosts = new Set(
	[env.APP_URL, env.SHORT_LINK_URL].filter(Boolean).map((url) => new URL(url as string).hostname.toLowerCase()),
);

/**
 * A verified custom domain shows the account's primary resume at `/` and nothing else of the app: the page's PDF and
 * contact requests pass through, and any other address goes to the app's own domain. Unknown hosts are left alone.
 */
export async function handleCustomDomain(request: Request, trustedClient: string): Promise<Response | null> {
	if (!isCustomDomainsEnabled()) return null;
	const url = new URL(request.url);
	const hostname = url.hostname.toLowerCase();
	if (appHosts.has(hostname)) return null;
	const target = await targetOf(hostname);
	if (!target) return null;

	if (url.pathname.startsWith("/api/resumes/") || /^\/favicon\.(ico|svg)$/.test(url.pathname)) return null;
	if (url.pathname === "/robots.txt")
		return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain; charset=UTF-8" } });
	if (url.pathname !== "/") return Response.redirect(new URL(`${url.pathname}${url.search}`, env.APP_URL), 301);

	// No primary resume: the page says it isn't shared, as for any address that isn't.
	if (!target.slug) return unavailableResponse(request);
	const address = { username: target.username, slug: target.slug };
	const options = { customDomain: hostname };
	if (request.method === "POST") return handleResumeWebPagePassword(request, address, trustedClient, options);
	return handleResumeWebPage(request, address, trustedClient, options);
}

const NAME = /^[\w@.-]{1,100}$/;

/**
 * `GET /api/internal/traefik?service=…&entryPoint=…&certResolver=…`: the routers Traefik's HTTP provider polls. The
 * query names the deployment's own Traefik service, entry point and resolver; the secret header keeps it private.
 */
export async function handleTraefikProvider(request: Request): Promise<Response> {
	const secret = env.CUSTOM_DOMAIN_PROVIDER_SECRET;
	const given = request.headers.get("x-provider-secret") ?? "";
	if (
		!secret ||
		!isCustomDomainsEnabled() ||
		given.length !== secret.length ||
		!timingSafeEqual(Buffer.from(given), Buffer.from(secret))
	)
		return new Response("Not Found", { status: 404 });

	const params = new URL(request.url).searchParams;
	const options = {
		service: params.get("service") ?? "",
		entryPoint: params.get("entryPoint") ?? "websecure",
		certResolver: params.get("certResolver") ?? "letsencrypt",
	};
	if (!Object.values(options).every((value) => NAME.test(value)))
		return new Response("service, entryPoint and certResolver must be Traefik names", { status: 400 });

	return Response.json(await traefikConfiguration(options), { headers: { "Cache-Control": "no-store" } });
}
