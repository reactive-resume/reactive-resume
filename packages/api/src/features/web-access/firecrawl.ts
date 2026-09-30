import type { ProviderRequest } from "./contracts";
import { Firecrawl } from "firecrawl";
import z from "zod";
import { htmlToText } from "./builtin";
import { MAX_PAGE_BYTES, WebAccessError } from "./contracts";
import { normalizeSearch, parseResponse } from "./transport";

function client({ connection, signal }: ProviderRequest) {
	signal.throwIfAborted();
	const sdk = new Firecrawl({
		apiKey: connection.apiKey ?? "",
		apiUrl: connection.apiUrl || "https://api.firecrawl.dev",
		timeoutMs: 15_000,
		// SDK maxRetries counts attempts, not retries. Disable automatic retries and scrape auto-resume.
		maxRetries: 1,
	});
	// Firecrawl 4.42 has no public abort/size options. Bind its per-request Axios transport; real-SDK tests guard this.
	const transport = sdk as unknown as {
		http: {
			instance: {
				defaults: {
					signal: AbortSignal;
					maxContentLength: number;
					maxRedirects: number;
				};
			};
		};
	};
	Object.assign(transport.http.instance.defaults, {
		signal,
		maxContentLength: MAX_PAGE_BYTES,
		maxRedirects: 0,
	});
	return sdk;
}

async function request<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		signal.throwIfAborted();
		if (error instanceof WebAccessError) throw error;
		const failure = error as {
			status?: number;
			code?: string;
			message?: string;
		};
		if (failure.status === 401 || failure.status === 403) throw new WebAccessError("auth");
		if (failure.status === 402 || failure.status === 429) throw new WebAccessError("quota");
		if (failure.status === 200) throw new WebAccessError("malformed");
		if (failure.code === "ETIMEDOUT" || failure.code === "ECONNABORTED") throw new WebAccessError("timeout");
		if (/maxContentLength/i.test(failure.message ?? "")) throw new WebAccessError("too-large");
		throw new WebAccessError("unreachable");
	}
}

const scrapeSchema = z.object({
	markdown: z.string().max(MAX_PAGE_BYTES).optional(),
	rawHtml: z.string().max(MAX_PAGE_BYTES).optional(),
	metadata: z
		.object({
			statusCode: z.number().optional(),
			url: z.string().optional(),
			sourceURL: z.string().optional(),
			error: z.string().nullable().optional(),
		})
		.optional(),
});

export async function readFirecrawl(url: string, options: ProviderRequest) {
	const result = parseResponse(
		scrapeSchema,
		await request(
			() =>
				client(options).scrape(url, {
					formats: ["markdown", "rawHtml"],
					onlyMainContent: true,
					skipTlsVerification: false,
					timeout: 14_000,
					autoResume: false,
				}),
			options.signal,
		),
	);
	if (result.metadata?.error || (result.metadata?.statusCode ?? 200) >= 400) throw new WebAccessError("unreachable");
	return {
		content: result.markdown?.trim() || htmlToText(result.rawHtml ?? ""),
		format: result.markdown?.trim() ? ("markdown" as const) : ("text" as const),
		...(result.rawHtml ? { html: result.rawHtml } : {}),
		...(result.metadata?.url ? { resolvedUrl: result.metadata.url } : {}),
	};
}

const searchSchema = z.object({ web: z.array(z.unknown()).max(100) });
const itemSchema = z.object({
	url: z.string(),
	title: z.string(),
	description: z.string().optional(),
});
export async function searchFirecrawl(query: string, options: ProviderRequest) {
	const result = parseResponse(
		searchSchema,
		await request(
			() =>
				client(options).search(query, {
					sources: ["web"],
					limit: 5,
					timeout: 14_000,
				}),
			options.signal,
		),
	);
	return normalizeSearch(
		result.web.flatMap((value) => {
			const item = itemSchema.safeParse(value);
			return item.success
				? [
						{
							url: item.data.url,
							title: item.data.title,
							snippet: item.data.description,
						},
					]
				: [];
		}),
	);
}
