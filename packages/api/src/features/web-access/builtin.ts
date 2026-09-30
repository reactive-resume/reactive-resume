import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { lookup } from "node:dns";
import { lookup as lookupAddresses } from "node:dns/promises";
import { request } from "node:https";
import sanitizeHtml from "sanitize-html";
import { isPrivateOrLoopbackHost, parseUrl } from "@reactive-resume/utils/url-security.node";
import { MAX_PAGE_BYTES, WebAccessError } from "./contracts";

/** Preserve the posting reader's HTTPS-only policy. */
export function assertPublicPageUrl(input: string): URL {
	const url = parseUrl(input.trim());
	if (url?.protocol !== "https:" || url.username || url.password || isPrivateOrLoopbackHost(url.hostname)) {
		throw new WebAccessError("unsafe-url");
	}
	url.hash = "";
	return url;
}

const allPublic = (addresses: readonly Pick<LookupAddress, "address">[]) =>
	addresses.length > 0 && addresses.every((entry) => !isPrivateOrLoopbackHost(entry.address));

/** DNS cannot be cancelled, but abort immediately stops waiting and prevents a subsequent provider request. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const aborted = () => reject(signal.reason);
		signal.addEventListener("abort", aborted, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
	});
}

export async function assertPublicTarget(input: string, signal: AbortSignal) {
	const url = assertPublicPageUrl(input);
	const addresses = await abortable(lookupAddresses(url.hostname, { all: true }), signal).catch((error) => {
		signal.throwIfAborted();
		if (error instanceof WebAccessError) throw error;
		throw new WebAccessError("unreachable");
	});
	if (!allPublic(addresses)) throw new WebAccessError("unsafe-url");
	return url;
}

/** Validate every address on the socket's actual lookup, preventing DNS rebinding. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, "", 4);
		const list = addresses as LookupAddress[];
		if (!allPublic(list)) return callback(new WebAccessError("unsafe-url"), "", 4);
		if (options.all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
		const [first] = list;
		callback(null, first?.address ?? "", first?.family ?? 4);
	});
};

export function readBuiltinPage(
	input: string,
	signal: AbortSignal,
	redirects = 0,
): Promise<{ html: string; resolvedUrl: string }> {
	signal.throwIfAborted();
	const url = assertPublicPageUrl(input);
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: "GET",
				lookup: publicLookup,
				signal,
				headers: {
					accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
					"user-agent": "Mozilla/5.0 (compatible; ReactiveResume; public page reader)",
				},
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const location = res.headers.location;
				if (status >= 300 && status < 400 && location) {
					res.resume();
					if (redirects >= 3) return reject(new WebAccessError("unreachable"));
					try {
						resolve(readBuiltinPage(new URL(location, url).toString(), signal, redirects + 1));
					} catch (error) {
						reject(error);
					}
					return;
				}
				if (status < 200 || status >= 300) {
					res.resume();
					return reject(new WebAccessError("unreachable"));
				}
				if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(String(res.headers["content-type"] ?? ""))) {
					res.resume();
					return reject(new WebAccessError("not-a-page"));
				}
				const chunks: Buffer[] = [];
				let size = 0;
				res.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_PAGE_BYTES) return req.destroy(new WebAccessError("too-large"));
					chunks.push(chunk);
				});
				res.on("end", () => {
					if (signal.aborted) return reject(signal.reason);
					resolve({
						html: Buffer.concat(chunks).toString("utf8"),
						resolvedUrl: url.toString(),
					});
				});
				res.on("error", reject);
			},
		);
		req.on("error", (error) => {
			if (signal.aborted) return reject(signal.reason);
			reject(error instanceof WebAccessError ? error : new WebAccessError("unreachable"));
		});
		req.end();
	});
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};
function numericEntityCharacter(name: string) {
	const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
	return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : null;
}
const decodeEntities = (text: string) =>
	text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (!name.startsWith("#")) return ENTITIES[name.toLowerCase()] ?? entity;
		return numericEntityCharacter(name) ?? entity;
	});

/** Generic page text; JobPosting extraction stays in Applications. */
export function htmlToText(html: string): string {
	// Keep invalid numeric entities as evidence instead of the sanitizer replacing them with U+FFFD.
	const safeEntities = html.replace(/&(#x[\da-f]+|#\d+);/gi, (entity, name: string) =>
		numericEntityCharacter(name) === null ? `&amp;${entity.slice(1)}` : entity,
	);
	const text = sanitizeHtml(
		safeEntities.replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|header|ul|ol)>|<br\s*\/?>/gi, "\n"),
		{
			allowedTags: [],
			allowedAttributes: {},
			nonTextTags: ["script", "style", "noscript", "template", "textarea", "option", "head", "svg", "nav", "footer"],
		},
	);
	return decodeEntities(text)
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}
