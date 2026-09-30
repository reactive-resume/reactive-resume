import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import type { FirecrawlConfig } from "../firecrawl/service";
import { lookup } from "node:dns";
import { lookup as lookupAddresses } from "node:dns/promises";
import { request } from "node:https";
import { Firecrawl } from "firecrawl";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { isPrivateOrLoopbackHost, parseUrl } from "@reactive-resume/utils/url-security.node";

/** Matches the applications feature's cap on a saved posting. */
export const MAX_POSTING_CHARS = 20_000;
const MAX_PAGE_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export class PostingFetchError extends Error {
	constructor(readonly reason: "unsafe-url" | "unreachable" | "not-a-page" | "too-large") {
		super(`The posting couldn't be fetched (${reason}).`);
		this.name = "PostingFetchError";
	}
}

/** A lone http(s) link, as opposed to pasted posting text. */
export const isPostingLink = (input: string) => /^https?:\/\/\S+$/i.test(input.trim());

/** Only public https pages: no credentials, other schemes, or private and loopback hosts. */
export function assertPublicPageUrl(input: string): URL {
	const url = parseUrl(input.trim());
	if (url?.protocol !== "https:" || url.username || url.password || isPrivateOrLoopbackHost(url.hostname)) {
		throw new PostingFetchError("unsafe-url");
	}
	url.hash = "";
	return url;
}

/** Whether every address a host resolved to is public. One private address is enough to refuse it. */
export const allPublic = (addresses: readonly Pick<LookupAddress, "address">[]) =>
	addresses.length > 0 && addresses.every((entry) => !isPrivateOrLoopbackHost(entry.address));

/**
 * The socket's DNS lookup: it resolves the host and refuses private addresses at connect time, so a name that
 * later resolves somewhere else can't slip past a check made beforehand.
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, addresses) => {
		if (error) return callback(error, "", 4);
		const list = addresses as LookupAddress[];
		if (!allPublic(list)) return callback(new PostingFetchError("unsafe-url"), "", 4);
		if (options.all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
		const [first] = list;
		callback(null, first?.address ?? "", first?.family ?? 4);
	});
};

/** Fetches a public job page's HTML: https only, public addresses only, a few redirects, 2 MB and 10 s at most. */
export function fetchPostingPage(input: string, redirects = 0): Promise<string> {
	const url = assertPublicPageUrl(input);

	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				method: "GET",
				lookup: publicLookup,
				timeout: TIMEOUT_MS,
				headers: {
					accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
					"user-agent": "Mozilla/5.0 (compatible; ReactiveResume; job posting reader)",
				},
			},
			(res) => {
				const status = res.statusCode ?? 0;
				const location = res.headers.location;

				if (status >= 300 && status < 400 && location) {
					res.resume();
					if (redirects >= MAX_REDIRECTS) return reject(new PostingFetchError("unreachable"));
					return resolve(fetchPostingPage(new URL(location, url).toString(), redirects + 1));
				}
				if (status < 200 || status >= 300) {
					res.resume();
					return reject(new PostingFetchError("unreachable"));
				}
				if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(String(res.headers["content-type"] ?? ""))) {
					res.resume();
					return reject(new PostingFetchError("not-a-page"));
				}

				const chunks: Buffer[] = [];
				let size = 0;
				res.on("data", (chunk: Buffer) => {
					size += chunk.length;
					if (size > MAX_PAGE_BYTES) return req.destroy(new PostingFetchError("too-large"));
					chunks.push(chunk);
				});
				res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
				res.on("error", reject);
			},
		);

		req.on("timeout", () => req.destroy(new PostingFetchError("unreachable")));
		req.on("error", (error) =>
			reject(error instanceof PostingFetchError ? error : new PostingFetchError("unreachable")),
		);
		req.end();
	});
}

const firecrawl = (config: FirecrawlConfig) => new Firecrawl({ ...config, timeoutMs: 65_000, maxRetries: 1 });

const scrapeResponse = z.object({
	markdown: z.string().max(MAX_PAGE_BYTES).optional(),
	rawHtml: z.string().max(MAX_PAGE_BYTES).optional(),
	metadata: z.object({ statusCode: z.number().optional() }).optional(),
});

/** Firecrawl renders dynamic pages; the built-in reader remains the fallback when it is unavailable. */
export async function fetchJobPosting(
	input: string,
	config: FirecrawlConfig | null,
): Promise<{ page: PagePosting | null; text: string }> {
	const url = assertPublicPageUrl(input);
	if (config) {
		// Preflight before delegating. Firecrawl must also enforce public destinations on redirects and at connect time.
		const addresses = await lookupAddresses(url.hostname, { all: true }).catch(() => []);
		if (!allPublic(addresses)) throw new PostingFetchError("unsafe-url");
		try {
			const data = scrapeResponse.parse(
				await firecrawl(config).scrape(url.toString(), {
					formats: ["markdown", "rawHtml"],
					onlyMainContent: true,
					skipTlsVerification: false,
					timeout: 60_000,
					autoResume: false,
				}),
			);
			if (data.metadata?.statusCode && data.metadata.statusCode >= 400) throw new PostingFetchError("unreachable");
			const page = readJobPosting(data.rawHtml ?? "");
			const text = page?.description || data.markdown?.trim() || htmlToText(data.rawHtml ?? "");
			if (text) return { page, text: text.slice(0, MAX_POSTING_CHARS) };
		} catch {
			// Preserve URL import when Firecrawl is down, rate limited, or cannot read this page.
		}
	}
	const html = await fetchPostingPage(url.toString());
	const page = readJobPosting(html);
	return { page, text: (page?.description || htmlToText(html)).slice(0, MAX_POSTING_CHARS) };
}

export const postingSearchResult = z.object({
	url: z.string(),
	title: z.string().max(1_000),
	description: z.string().max(5_000).default(""),
});

/** Five web results for an explicit job query; no postings are scraped until the user selects one. */
export async function searchJobPostings(query: string, config: FirecrawlConfig) {
	const response = await firecrawl(config).search(`${query} job posting`, {
		sources: ["web"],
		limit: 5,
		timeout: 60_000,
	});
	return (response.web ?? [])
		.flatMap((item) => {
			const result = postingSearchResult.safeParse(item);
			if (!result.success) return [];
			try {
				return [{ ...result.data, url: assertPublicPageUrl(result.data.url).toString() }];
			} catch {
				return [];
			}
		})
		.slice(0, 5);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decodeEntities = (text: string) =>
	text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
		if (/^#x/i.test(name)) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
		if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
		return ENTITIES[name.toLowerCase()] ?? entity;
	});

/** A page's readable text: block elements become line breaks; scripts, styles and markup go. */
export function htmlToText(html: string): string {
	const withBreaks = html.replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|header|ul|ol)>|<br\s*\/?>/gi, "\n");
	const text = sanitizeHtml(withBreaks, {
		allowedTags: [],
		allowedAttributes: {},
		nonTextTags: ["script", "style", "noscript", "template", "textarea", "option", "head", "svg", "nav", "footer"],
	});

	return decodeEntities(text)
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}

export type PagePosting = { role: string; company: string; location: string; description: string };

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function readLocation(value: unknown): string {
	const place = (Array.isArray(value) ? value[0] : value) as { address?: Record<string, unknown> } | undefined;
	const address = place?.address;
	if (!address || typeof address !== "object") return "";
	return [address.addressLocality, address.addressRegion, address.addressCountry]
		.map((part) => (typeof part === "object" && part ? asText((part as { name?: unknown }).name) : asText(part)))
		.filter(Boolean)
		.join(", ");
}

/**
 * The JobPosting a page describes in its JSON-LD (most job boards publish one), read without any AI: title,
 * hiring organisation, location and the description as text.
 */
export function readJobPosting(html: string): PagePosting | null {
	for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		let json: unknown;
		try {
			json = JSON.parse(match[1] ?? "");
		} catch {
			continue;
		}

		const candidates = [
			json,
			...(Array.isArray(json) ? json : []),
			...((json as { "@graph"?: unknown[] })?.["@graph"] ?? []),
		];
		const posting = candidates.find((item) => {
			const type = (item as { "@type"?: unknown } | null)?.["@type"];
			return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
		}) as Record<string, unknown> | undefined;
		if (!posting) continue;

		const organization = posting.hiringOrganization as { name?: unknown } | string | undefined;
		return {
			role: asText(posting.title),
			company: typeof organization === "string" ? organization.trim() : asText(organization?.name),
			location: readLocation(posting.jobLocation),
			description: htmlToText(asText(posting.description)),
		};
	}

	return null;
}
