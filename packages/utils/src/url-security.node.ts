import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { lookup } from "node:dns";
import { lookup as lookupAddresses, resolve4, resolve6 } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

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
	["::", 128],
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

/** Requires global_fetch_strictly_public: Workers enforces public routing at connection time, including rebinding. */
export async function fetchWorkerPublicUrl(
	input: URL,
	options: { signal: AbortSignal; headers?: HeadersInit },
): Promise<Response> {
	if (process.env.CLOUDFLARE !== "1") throw new Error("Public Worker fetch requires Cloudflare");
	let url = input;
	for (let redirects = 0; redirects <= 3; redirects++) {
		if (!/^https?:$/.test(url.protocol) || url.username || url.password || isPrivateOrLoopbackHost(url.hostname)) {
			throw new Error("Private network address refused", { cause: "unsafe-url" });
		}
		const addresses = await resolveHostAddresses(url.hostname);
		options.signal.throwIfAborted();
		if (!addresses.length || addresses.some(({ address }) => isPrivateOrLoopbackHost(address))) {
			throw new Error("Private network address refused", { cause: "unsafe-url" });
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

type OAuthRedirectUriOptions = {
	allowUnsafe?: boolean;
};

export function isAllowedOAuthRedirectUri(input: string, trustedOrigins: string[], options?: OAuthRedirectUriOptions) {
	const parsed = parseUrl(input);
	if (!parsed) return false;
	if (options?.allowUnsafe) return true;
	if (parsed.username || parsed.password) return false;
	if (parsed.hash) return false;

	const origin = parsed.origin.toLowerCase();
	const hostname = stripIpv6Brackets(normalizeHostname(parsed.hostname));

	// Our own origins stay allowed even when they resolve to a private network, so self-hosted
	// deployments reachable only over a LAN address keep working.
	if (trustedOrigins.includes(origin)) return true;

	if (parsed.protocol === "http:") return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
	if (parsed.protocol !== "https:") return false;

	// Dynamic client registration must accept callbacks from clients we have never seen (Claude,
	// other MCP hosts). Consent plus exact-match redirect comparison at authorization time is the
	// real gate; an origin allowlist here only breaks DCR. Private/loopback https hosts stay out so
	// a registration cannot point our redirects at an internal network.
	return !isPrivateOrLoopbackHost(hostname);
}
