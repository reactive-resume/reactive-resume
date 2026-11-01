import type {
	ProviderRequest,
	ReadPageResult,
	WebAccessConnection,
	WebAccessContext,
	WebAccessFailure,
} from "./contracts";
import { env } from "@reactive-resume/env/server";
import { rateLimitConfig } from "@reactive-resume/utils/rate-limit";
import { abortable } from "@reactive-resume/utils/url-security.node";
import { createRateLimiter } from "../../redis";
import { assertPublicTarget, htmlToText, readBuiltinPage } from "./builtin";
import { MAX_SEARCH_QUERY_CHARS, MAX_SEARCH_RESULTS, WEB_ACCESS_DEADLINE_MS, WebAccessError } from "./contracts";
import { webAccessService } from "./credentials";
import { readExa, searchExa } from "./exa";
import { readFirecrawl, searchFirecrawl } from "./firecrawl";
import { searchSearxng } from "./searxng";
import { readTavily, searchTavily } from "./tavily";
import { pageContent, safeFailure } from "./transport";

const limiter = createRateLimiter("web-access", rateLimitConfig.orpc.aiRequest);

async function consume(userId: string, signal: AbortSignal) {
	signal.throwIfAborted();
	if (process.env.NODE_ENV !== "production" || env.FLAG_DISABLE_API_RATE_LIMIT) return;
	const { success } = await abortable(limiter.limit(userId), signal);
	if (!success) throw new WebAccessError("rate-limit");
}

const deadline = (signal?: AbortSignal) =>
	AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(WEB_ACCESS_DEADLINE_MS)]);

async function externalSearch(query: string, options: ProviderRequest) {
	try {
		switch (options.connection.provider) {
			case "firecrawl":
				return await searchFirecrawl(query, options);
			case "tavily":
				return await searchTavily(query, options);
			case "exa":
				return await searchExa(query, options);
		}
	} catch (error) {
		throw safeFailure(error, options.signal);
	}
}

async function externalRead(url: string, options: ProviderRequest) {
	try {
		switch (options.connection.provider) {
			case "firecrawl":
				return await readFirecrawl(url, options);
			case "tavily":
				return await readTavily(url, options);
			case "exa":
				return await readExa(url, options);
		}
	} catch (error) {
		throw safeFailure(error, options.signal);
	}
}

function log(operation: "search" | "read", provider: string, started: number, outcome: string, fallback?: string) {
	console.info("[web-access]", {
		provider,
		operation,
		durationMs: Date.now() - started,
		outcome,
		...(fallback ? { fallback } : {}),
	});
}

function searchInput(query: string) {
	const input = query.trim();
	if (!input || input.length > MAX_SEARCH_QUERY_CHARS) throw new WebAccessError("malformed");
	return input;
}

/** Deduplicates by URL and takes results round-robin in region order, so each region that returned anything shows. */
function interleave<T extends { url: string }>(lists: T[][]) {
	const seen = new Set<string>();
	const merged: T[] = [];
	const longest = Math.max(...lists.map((list) => list.length));
	for (let index = 0; index < longest; index++) {
		for (const list of lists) {
			const item = list[index];
			if (!item || seen.has(item.url)) continue;
			seen.add(item.url);
			merged.push(item);
		}
	}
	return merged.slice(0, MAX_SEARCH_RESULTS);
}

type SearchResults = Awaited<ReturnType<typeof externalSearch>>;

/** Where searches go: the operator's SearXNG when set, otherwise the web connection's provider. */
function searchBackend(context: WebAccessContext, signal: AbortSignal) {
	const baseUrl = env.WEB_SEARCH_SEARXNG_URL;
	if (baseUrl)
		return {
			name: "searxng",
			search: (query: string, region?: string): Promise<SearchResults> =>
				searchSearxng(query, { baseUrl, region, signal }),
		};
	const connection = context.connection;
	if (!connection) return null;
	return {
		name: connection.provider,
		search: (query: string, region?: string) =>
			externalSearch(query, region ? { connection, signal, region } : { connection, signal }),
	};
}

/**
 * One rate-limited search. Each region gets its own search call, with `queryFor(region)` as its query when given,
 * in parallel under one deadline. A failed region drops out unless every region fails.
 */
export async function searchWeb(query: string, context: WebAccessContext, queryFor?: (region: string) => string) {
	const signal = deadline(context.signal);
	const started = Date.now();
	const backend = searchBackend(context, signal);
	const provider = backend?.name ?? "builtin";
	try {
		await consume(context.userId, signal);
		if (!backend) throw new WebAccessError("unavailable");
		const input = searchInput(query);
		const searches = (context.regions ?? []).map((region) => ({
			region,
			query: queryFor ? searchInput(queryFor(region)) : input,
		}));
		let results: SearchResults;
		let partial: string | undefined;
		if (searches.length === 0) results = await backend.search(input);
		else {
			const settled = await Promise.allSettled(searches.map((search) => backend.search(search.query, search.region)));
			const lists = settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
			if (lists.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
			const failed = settled.length - lists.length;
			if (failed) partial = `${failed}/${settled.length}-regions-failed`;
			results = interleave(lists);
		}
		signal.throwIfAborted();
		log("search", provider, started, "success", partial);
		return results;
	} catch (error) {
		if (
			!signal.aborted &&
			provider !== "searxng" &&
			error instanceof WebAccessError &&
			(error.reason === "auth" || error.reason === "quota")
		) {
			const result = { success: false, error: error.reason };
			await webAccessService
				.recordTest(context.userId, context.connection, { search: result, read: result })
				.catch(() => undefined);
		}
		log(
			"search",
			provider,
			started,
			signal.aborted ? "aborted" : error instanceof WebAccessError ? error.reason : "unreachable",
		);
		throw safeFailure(error, signal);
	}
}

/** One deadline covers DNS, the selected provider, and the direct fallback. Cancellation never falls back. */
export async function readPage(input: string, context: WebAccessContext): Promise<ReadPageResult> {
	const signal = deadline(context.signal);
	const started = Date.now();
	const provider = context.connection?.provider ?? "builtin";
	let fallback: WebAccessFailure | undefined;
	try {
		await consume(context.userId, signal);
		const url = await assertPublicTarget(input, signal);
		if (context.connection) {
			// Reserve five seconds of the same overall budget for the direct reader.
			const externalBudget = Math.max(1, WEB_ACCESS_DEADLINE_MS - (Date.now() - started) - 5_000);
			const externalSignal = AbortSignal.any([signal, AbortSignal.timeout(externalBudget)]);
			try {
				// Remote services must independently protect their own redirects and DNS lookups.
				const page = await externalRead(url.toString(), {
					connection: context.connection,
					signal: externalSignal,
				});
				if (page.resolvedUrl) await assertPublicTarget(page.resolvedUrl, externalSignal);
				const content = pageContent(page.content);
				externalSignal.throwIfAborted();
				log("read", provider, started, "success");
				return {
					...page,
					...content,
					requestedUrl: url.toString(),
					retrievedAt: new Date().toISOString(),
					method: context.connection.provider,
				};
			} catch (error) {
				signal.throwIfAborted();
				const failure = safeFailure(error, externalSignal);
				if (failure.reason === "unsafe-url") throw failure;
				fallback = failure.reason;
				if (failure.reason === "auth" || failure.reason === "quota") {
					const result = { success: false, error: failure.reason };
					await webAccessService
						.recordTest(context.userId, context.connection, { search: result, read: result })
						.catch(() => undefined);
				}
			}
		}
		const page = await readBuiltinPage(url.toString(), signal);
		const content = pageContent(htmlToText(page.html));
		signal.throwIfAborted();
		log("read", provider, started, "success", fallback ? `${fallback}:builtin` : undefined);
		return {
			...page,
			...content,
			requestedUrl: url.toString(),
			retrievedAt: new Date().toISOString(),
			method: "builtin",
			format: "text",
			...(fallback ? { fallbackReason: fallback } : {}),
		};
	} catch (error) {
		log(
			"read",
			provider,
			started,
			signal.aborted ? "aborted" : error instanceof WebAccessError ? error.reason : "unreachable",
			fallback ? `${fallback}:failed` : undefined,
		);
		throw safeFailure(error, signal);
	}
}

/**
 * Explicit settings test. Provider operations are independent and never use the built-in fallback. Search is tested
 * against SearXNG when the server sends searches there, and the log names which service each operation tested.
 * Without a connection, reading is not tested and reports `unavailable`: only the built-in reader serves it.
 */
export async function probeWebAccess(
	connection: WebAccessConnection | null,
	context: { userId: string; signal?: AbortSignal | undefined; region?: string | undefined },
) {
	const signal = deadline(context.signal);
	await consume(context.userId, signal);
	const searxng = env.WEB_SEARCH_SEARXNG_URL;
	const probe = async (operation: "search" | "read") => {
		const started = Date.now();
		const provider = operation === "search" && searxng ? "searxng" : (connection?.provider ?? "builtin");
		try {
			if (operation === "search" && searxng)
				await searchSearxng("example domain", { baseUrl: searxng, region: context.region, signal });
			else if (!connection) throw new WebAccessError("unavailable");
			else if (operation === "search")
				await externalSearch("example domain", { connection, signal, region: context.region });
			else {
				const url = await assertPublicTarget("https://example.com/", signal);
				const page = await externalRead(url.toString(), { connection, signal });
				pageContent(page.content);
				if (page.resolvedUrl) await assertPublicTarget(page.resolvedUrl, signal);
			}
			signal.throwIfAborted();
			log(operation, provider, started, "success");
			return { success: true };
		} catch (error) {
			const failure = safeFailure(error, signal);
			log(operation, provider, started, failure.reason);
			return { success: false, error: failure.reason };
		}
	};
	const [search, read] = await Promise.all([probe("search"), probe("read")]);
	return { search, read };
}
