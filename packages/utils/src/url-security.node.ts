import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import type { Transform } from "node:stream";
import { lookup } from "node:dns";
import { lookup as lookupAddresses, resolve4, resolve6 } from "node:dns/promises";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

function normalizeHostname(hostname: string) {
	return hostname.trim().toLowerCase();
}

function stripIpv6Brackets(hostname: string): string {
	return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

const blockedIpv4Cidrs: Array<[string, number]> = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
];

const blockedIpv6Cidrs: Array<[string, number]> = [
	// Unspecified, loopback and the deprecated IPv4-compatible block (an IPv4 address in the low 32 bits).
	["::", 96],
	["::1", 128],
	["::ffff:0:0", 96],
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["100:0:0:1::", 64],
	["2001::", 23],
	["2001:2::", 48],
	["2001:10::", 28],
	["2001:db8::", 32],
	["2002::", 16],
	["3fff::", 20],
	["5f00::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["fec0::", 10],
	["ff00::", 8],
];

const blockedIpv4s = new BlockList();
for (const [address, prefix] of blockedIpv4Cidrs) blockedIpv4s.addSubnet(address, prefix, "ipv4");

const blockedIpv6s = new BlockList();
for (const [address, prefix] of blockedIpv6Cidrs) blockedIpv6s.addSubnet(address, prefix, "ipv6");

export function isPrivateOrLoopbackHost(hostname: string) {
	const normalized = stripIpv6Brackets(normalizeHostname(hostname));
	if (normalized.startsWith("::ffff:")) return true;
	if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".localhost")) return true;

	const ipVersion = isIP(normalized);
	if (ipVersion === 4) return blockedIpv4s.check(normalized, "ipv4");
	if (ipVersion === 6) return blockedIpv6s.check(normalized, "ipv6");

	return false;
}

/** Check every address during the socket's actual DNS lookup, preventing rebinding. */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, "", 4);
		const list = addresses as LookupAddress[];
		if (!list.length || list.some((entry) => isPrivateOrLoopbackHost(entry.address)))
			return callback(new Error("Private network address refused", { cause: "unsafe-url" }), "", 4);
		if (options.all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
		const [first] = list;
		callback(null, first?.address ?? "", first?.family ?? 4);
	});
};

/** Workers implements resolve4/resolve6, but not dns.lookup. */
export async function resolveHostAddresses(hostname: string): Promise<Pick<LookupAddress, "address">[]> {
	const host = stripIpv6Brackets(hostname);
	if (isIP(host)) return [{ address: host }];
	if (process.env.CLOUDFLARE !== "1") return lookupAddresses(host, { all: true });
	const results = await Promise.allSettled([resolve4(host), resolve6(host)]);
	return results.flatMap((result) =>
		result.status === "fulfilled" ? result.value.map((address) => ({ address })) : [],
	);
}

/** DNS cannot be cancelled, but abort immediately stops waiting and prevents a subsequent request. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener("abort", aborted, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
	});
}

const unsafeUrl = () => new Error("Private network address refused", { cause: "unsafe-url" });
const MAX_PUBLIC_RESPONSE_BYTES = 64 * 1024 * 1024;
// Own connection pools: a reused socket was always opened through `publicLookup`, never by other code.
let publicAgents: { http: HttpAgent; https: HttpsAgent } | undefined;
const publicAgent = (protocol: string) => {
	publicAgents ??= {
		// Like Node's global agent: idle sockets close after 5 s, before servers usually drop them.
		http: new HttpAgent({ keepAlive: true, timeout: 5000, lookup: publicLookup }),
		https: new HttpsAgent({ keepAlive: true, timeout: 5000, lookup: publicLookup }),
	};
	return protocol === "https:" ? publicAgents.https : publicAgents.http;
};
/** The pooled HTTPS agent that resolves every connection through `publicLookup`. */
export const publicHttpsAgent = () => publicAgent("https:") as HttpsAgent;

/** Errors the body once it passes the cap, so an endpoint can't fill memory however it frames the response. */
function capped(body: ReadableStream<Uint8Array>) {
	let size = 0;
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				size += chunk.byteLength;
				if (size > MAX_PUBLIC_RESPONSE_BYTES) controller.error(new Error("Response too large"));
				else controller.enqueue(chunk);
			},
		}),
	);
}

// fetch decodes these itself; a response read from a socket has to be decoded here.
const decoders = new Map<string, () => Transform>([
	["gzip", createGunzip],
	["x-gzip", createGunzip],
	["deflate", createInflate],
	["br", createBrotliDecompress],
]);

/**
 * `fetch` for endpoints a user chose. It connects only to public addresses, checking every DNS answer when the socket
 * connects (so rebinding can't swap one in), never follows redirects (the 3xx comes back as is, and credentials never
 * reach another host), and stops reading a response past 64 MiB.
 */
export async function fetchPublic(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const request = new Request(input, init);
	const url = new URL(request.url);
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || isPrivateOrLoopbackHost(url.hostname))
		throw unsafeUrl();
	// Workers' global_fetch_strictly_public refuses private destinations, including after DNS changes.
	if (process.env.CLOUDFLARE === "1") {
		const response = await fetch(request, { redirect: "manual" });
		const { status, statusText, headers } = response;
		return new Response(response.body ? capped(response.body) : null, { status, statusText, headers });
	}

	const body = request.body ? Buffer.from(await request.arrayBuffer()) : null;
	const headers = Object.fromEntries(request.headers);
	if (body) headers["content-length"] = String(body.byteLength);
	const send = url.protocol === "https:" ? httpsRequest : httpRequest;
	return new Promise((resolve, reject) => {
		const outgoing = send(
			url,
			{ method: request.method, headers, agent: publicAgent(url.protocol), signal: request.signal },
			(incoming) => {
				try {
					const status = incoming.statusCode ?? 0;
					// Response accepts 200-599 only; anything else would throw outside this promise.
					if (status < 200 || status > 599) throw new Error(`Invalid response status ${status}`);
					const responseHeaders = new Headers();
					for (const [name, value] of Object.entries(incoming.headers)) {
						for (const item of [value ?? []].flat()) responseHeaders.append(name, item);
					}
					const empty = request.method === "HEAD" || [204, 205, 304].includes(status);
					let stream: Readable = incoming;
					const decode = decoders.get(
						String(incoming.headers["content-encoding"] ?? "")
							.trim()
							.toLowerCase(),
					);
					if (!empty && decode) {
						// pipeline closes the socket too when the decoder stops (cap reached, body canceled).
						stream = pipeline(incoming, decode(), () => {});
						responseHeaders.delete("content-encoding");
						responseHeaders.delete("content-length");
					}
					if (empty) incoming.resume();
					resolve(
						new Response(empty ? null : capped(Readable.toWeb(stream) as ReadableStream<Uint8Array>), {
							status,
							statusText: incoming.statusMessage ?? "",
							headers: responseHeaders,
						}),
					);
				} catch (error) {
					incoming.destroy();
					reject(error);
				}
			},
		);
		outgoing.on("error", (error) => reject(error.cause === "unsafe-url" ? unsafeUrl() : error));
		outgoing.end(body ?? undefined);
	});
}

/** Requires global_fetch_strictly_public: Workers enforces public routing at connection time, including rebinding. */
export async function fetchWorkerPublicUrl(
	input: URL,
	options: { signal: AbortSignal; headers?: HeadersInit },
): Promise<Response> {
	if (process.env.CLOUDFLARE !== "1") throw new Error("Public Worker fetch requires Cloudflare");
	let url = input;
	for (let redirects = 0; redirects <= 3; redirects++) {
		if (!/^https?:$/.test(url.protocol) || url.username || url.password || isPrivateOrLoopbackHost(url.hostname)) {
			throw unsafeUrl();
		}
		const addresses = await abortable(resolveHostAddresses(url.hostname), options.signal);
		if (!addresses.length || addresses.some(({ address }) => isPrivateOrLoopbackHost(address))) {
			throw unsafeUrl();
		}
		const response = await fetch(url, { ...options, redirect: "manual" });
		const location = response.headers.get("location");
		if (response.status < 300 || response.status >= 400 || !location) return response;
		await response.body?.cancel();
		const next = new URL(location, url);
		if (url.protocol === "https:" && next.protocol !== "https:")
			throw new Error("HTTPS redirect required", { cause: "unsafe-url" });
		url = next;
	}
	throw new Error("Too many redirects");
}

export function parseUrl(input: string) {
	try {
		return new URL(input);
	} catch {
		return null;
	}
}

// Schemes a browser, OS or network stack owns. Mirrors Better Auth's native-client rule
// (`isNativePrivateUseRedirectUri` in @better-auth/core), which the provider applies again at registration.
const NON_PRIVATE_USE_SCHEMES = new Set([
	"http:",
	"https:",
	"ws:",
	"wss:",
	"file:",
	"ftp:",
	"mailto:",
	"javascript:",
	"data:",
	"vbscript:",
	"blob:",
	"about:",
	"view-source:",
]);
const REVERSE_DOMAIN_SCHEME = /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Desktop and mobile apps receive OAuth callbacks on their own scheme (RFC 8252 §7.1): either the
 * authority-free reverse-domain form (`com.example.app:/callback`) or a host and path
 * (`cursor://anysphere.cursor-mcp/oauth/callback`, which Cursor registers).
 */
function isPrivateUseRedirectUri(url: URL) {
	if (NON_PRIVATE_USE_SCHEMES.has(url.protocol)) return false;
	if (url.host) return url.pathname.startsWith("/");
	const rest = url.href.slice(url.protocol.length);
	return rest.startsWith("/") && !rest.startsWith("//") && REVERSE_DOMAIN_SCHEME.test(url.protocol.slice(0, -1));
}

type OAuthRedirectUriOptions = {
	allowUnsafe?: boolean;
};

export function isAllowedOAuthRedirectUri(input: string, trustedOrigins: string[], options?: OAuthRedirectUriOptions) {
	const parsed = parseUrl(input);
	if (!parsed) return false;
	// Script and local schemes stay refused even in unsafe mode.
	if (["javascript:", "data:", "vbscript:", "file:", "blob:"].includes(parsed.protocol)) return false;
	if (options?.allowUnsafe) return true;
	if (parsed.username || parsed.password) return false;
	if (parsed.hash) return false;

	const origin = parsed.origin.toLowerCase();
	const hostname = stripIpv6Brackets(normalizeHostname(parsed.hostname));

	// Our own origins stay allowed even when they resolve to a private network, so self-hosted
	// deployments reachable only over a LAN address keep working.
	if (trustedOrigins.includes(origin)) return true;

	if (parsed.protocol === "http:") return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
	if (parsed.protocol !== "https:") return isPrivateUseRedirectUri(parsed);

	// Dynamic client registration must accept callbacks from clients we have never seen (Claude,
	// other MCP hosts). Consent plus exact-match redirect comparison at authorization time is the
	// real gate; an origin allowlist here only breaks DCR. Private/loopback https hosts stay out so
	// a registration cannot point our redirects at an internal network.
	return !isPrivateOrLoopbackHost(hostname);
}
