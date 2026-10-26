import { timingSafeEqual } from "node:crypto";
import {
	customDomainUsername,
	isCustomDomainsEnabled,
	ownHosts,
	traefikConfiguration,
} from "@reactive-resume/api/features/custom-domain";
import { env } from "@reactive-resume/env/server";
import { serveResumePage } from "../static/resume-page";
import { onAppDomain } from "./alias";

// Hosts seen recently and whose primary resume they open; a minute is how long a new verification takes to show.
const cache = new Map<string, { username: string | null; expires: number }>();
const CACHE_MS = 60_000;
const CACHE_LIMIT = 5_000;

async function usernameOf(hostname: string): Promise<string | null> {
	const hit = cache.get(hostname);
	if (hit && hit.expires > Date.now()) return hit.username;
	const username = await customDomainUsername(hostname);
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(hostname, { username, expires: Date.now() + CACHE_MS });
	return username;
}

/**
 * A verified custom domain shows the account's primary resume at `/` and nothing else of the app: the page's PDF
 * downloads pass through, and any other address goes to the app's own domain. Unknown hosts are left alone.
 */
export async function handleCustomDomain(request: Request, trustedClient: string): Promise<Response | null> {
	if (!isCustomDomainsEnabled()) return null;
	const url = new URL(request.url);
	if (ownHosts().has(url.hostname)) return null;
	const username = await usernameOf(url.hostname);
	if (!username) return null;

	if (url.pathname.startsWith("/api/resumes/") || /^\/favicon\.(ico|svg)$/.test(url.pathname)) return null;
	if (url.pathname === "/robots.txt")
		return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain; charset=UTF-8" } });
	if (url.pathname !== "/") return Response.redirect(onAppDomain(url), 301);

	// Without a primary resume, the page says it isn't shared, as for any address that isn't.
	return serveResumePage(request, { username, primary: true }, trustedClient, { customDomain: url.hostname });
}

const NAME = /^[\w@.-]{1,100}$/;

/**
 * `GET /api/internal/traefik?service=…&entryPoint=…&certResolver=…`: the routers Traefik's HTTP provider polls. The
 * query names the deployment's own Traefik service, entry point and resolver; the secret header keeps it private.
 */
export async function handleTraefikProvider(request: Request): Promise<Response> {
	const secret = env.CUSTOM_DOMAIN_PROVIDER_SECRET;
	// Compared as bytes: a header with non-ASCII characters can match the secret's length in characters but not bytes.
	const given = Buffer.from(request.headers.get("x-provider-secret") ?? "");
	const expected = Buffer.from(secret ?? "");
	if (!secret || !isCustomDomainsEnabled() || given.length !== expected.length || !timingSafeEqual(given, expected))
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
