import type { WebAccessContext } from "../web-access/contracts";
import { z } from "zod";
import { htmlToText } from "../web-access/builtin";
import { MAX_CONTENT_CHARS } from "../web-access/contracts";
import { readPage, searchWeb } from "../web-access/service";

export { htmlToText } from "../web-access/builtin";
export { WebAccessError as PostingFetchError } from "../web-access/contracts";

/** Matches the applications feature's cap on a saved posting. */
export const MAX_POSTING_CHARS = MAX_CONTENT_CHARS;

/** A lone http(s) link, as opposed to pasted posting text. */
export const isPostingLink = (input: string) => /^https?:\/\/\S+$/i.test(input.trim());

export async function fetchJobPosting(input: string, context: WebAccessContext) {
	const { content, html, ...source } = await readPage(input, context);
	const page = readJobPosting(html ?? "");
	const text = page?.description || content;
	const truncated = source.truncated || text.length > MAX_POSTING_CHARS;
	return {
		page,
		text: text.slice(0, MAX_POSTING_CHARS),
		source: {
			...source,
			...(page?.description ? { format: "text" as const } : {}),
			truncated,
			completeness: truncated ? ("incomplete" as const) : source.completeness,
		},
	};
}

export const postingSearchResult = z.object({
	url: z.string(),
	title: z.string().max(1_000),
	description: z.string().max(5_000).default(""),
});

/** Job-specific query intent belongs here, never in the generic retrieval service. */
export async function searchJobPostings(query: string, context: WebAccessContext) {
	return (await searchWeb(`${query} job posting`, context)).map(({ url, title, snippet }) => ({
		url,
		title,
		description: snippet ?? "",
	}));
}

export type PagePosting = {
	role: string;
	company: string;
	location: string;
	description: string;
};

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

		const graph = (json as { "@graph"?: unknown } | null)?.["@graph"];
		const candidates = [json, ...(Array.isArray(json) ? json : []), ...(Array.isArray(graph) ? graph : [])];
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
