import type { ProviderRequest } from "./contracts";
import z from "zod";
import { MAX_PAGE_BYTES, WebAccessError } from "./contracts";
import { normalizeSearch, parseResponse, postJson } from "./transport";

const searchSchema = z.object({ results: z.array(z.unknown()).max(100) });
const itemSchema = z.object({
	url: z.string(),
	title: z.string(),
	content: z.string().optional(),
});
export async function searchTavily(query: string, { connection, signal }: ProviderRequest) {
	const response = parseResponse(
		searchSchema,
		await postJson(
			"https://api.tavily.com/search",
			{
				authorization: `Bearer ${connection.apiKey ?? ""}`,
			},
			{
				query,
				max_results: 5,
				search_depth: "basic",
				include_answer: false,
				include_raw_content: false,
			},
			signal,
		),
	);
	return normalizeSearch(
		response.results.flatMap((value) => {
			const item = itemSchema.safeParse(value);
			return item.success
				? [
						{
							url: item.data.url,
							title: item.data.title,
							snippet: item.data.content,
						},
					]
				: [];
		}),
	);
}

const extractSchema = z.object({
	results: z
		.array(
			z.object({
				url: z.string(),
				raw_content: z.string().max(MAX_PAGE_BYTES),
			}),
		)
		.max(100),
	failed_results: z.array(z.object({ url: z.string(), error: z.string().optional() })).optional(),
});
export async function readTavily(url: string, { connection, signal }: ProviderRequest) {
	const response = parseResponse(
		extractSchema,
		await postJson(
			"https://api.tavily.com/extract",
			{
				authorization: `Bearer ${connection.apiKey ?? ""}`,
			},
			{
				urls: [url],
				format: "markdown",
				extract_depth: "advanced",
				include_images: false,
				timeout: 14,
				// Omit query/chunks_per_source: relevance reranking can silently omit posting paragraphs.
			},
			signal,
		),
	);
	// Exactly one URL was requested; a provider-normalized failure URL still belongs to this request.
	if (response.failed_results?.length) throw new WebAccessError("unreachable");
	const result = response.results[0];
	if (!result) throw new WebAccessError("empty");
	return {
		content: result.raw_content,
		format: "markdown" as const,
		resolvedUrl: result.url,
	};
}
