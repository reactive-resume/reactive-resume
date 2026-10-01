import type { ProviderRequest } from "./contracts";
import z from "zod";
import { htmlToText } from "./builtin";
import { MAX_PAGE_BYTES, WebAccessError } from "./contracts";
import { normalizeSearch, parseResponse, postJson } from "./transport";

function request(path: string, body: unknown, { connection, signal }: ProviderRequest) {
	const base = (connection.apiUrl || "https://api.firecrawl.dev").replace(/\/+$/, "");
	return postJson(
		`${base}/v2/${path}`,
		connection.apiKey ? { authorization: `Bearer ${connection.apiKey}` } : {},
		body,
		signal,
	);
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
	const { data: result } = parseResponse(
		z.object({ success: z.literal(true), data: scrapeSchema }),
		await request(
			"scrape",
			{ url, formats: ["markdown", "rawHtml"], onlyMainContent: true, skipTlsVerification: false, timeout: 14_000 },
			options,
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
	const { data: result } = parseResponse(
		z.object({ success: z.literal(true), data: searchSchema }),
		await request("search", { query, sources: ["web"], limit: 5, timeout: 14_000 }, options),
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
