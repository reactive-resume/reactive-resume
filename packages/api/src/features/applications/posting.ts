import type { WebAccessContext } from "../web-access/contracts";
import { z } from "zod";
import { jobPostingsIn, readJobPosting as readStructuredPosting } from "@reactive-resume/import/job-posting";
import { countryName } from "@reactive-resume/utils/region";
import { htmlToText } from "../web-access/builtin";
import { MAX_CONTENT_CHARS, MAX_SEARCH_QUERY_CHARS, WebAccessError } from "../web-access/contracts";
import { readPage, searchWeb } from "../web-access/service";

export { htmlToText } from "../web-access/builtin";
export { WebAccessError as PostingFetchError } from "../web-access/contracts";

/** Matches the applications feature's cap on a saved posting. */
export const MAX_POSTING_CHARS = MAX_CONTENT_CHARS;

/** A lone http(s) link, as opposed to pasted posting text. */
export const isPostingLink = (input: string) => /^https?:\/\/\S+$/i.test(input.trim());

export async function fetchJobPosting(input: string, context: WebAccessContext) {
	const { content, html, ...source } = await readPage(input, context);
	if (isListingUrl(source.resolvedUrl ?? input) || jobPostingsIn(html ?? "").length > 1)
		throw new WebAccessError("not-a-page");
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

type PostingSearchContext = WebAccessContext & { locations?: string[] | undefined };

/**
 * Each region's query names its country ("designer in Frankreich job posting"), in the user's UI language or English
 * without one, unless the query already names one of the user's countries or Preferences locations, asks for remote
 * work, or would pass the search length limit. Naming the place moves Exa's `auto` search to local postings where its
 * location parameter barely does.
 */
function postingQueryFor(query: string, { regions = [], locale = "en", locations = [] }: PostingSearchContext) {
	const text = query.toLocaleLowerCase();
	const places = [...regions.flatMap((code) => [countryName(code, locale), countryName(code, "en")]), ...locations];
	const keep =
		/remote/i.test(query) ||
		locations.some((place) => place.trim().toLowerCase() === "remote") ||
		places.some((place) => place.trim() && text.includes(place.trim().toLocaleLowerCase()));
	return (region: string) => {
		const placed = `${query} in ${countryName(region, locale)} job posting`;
		return keep || placed.length > MAX_SEARCH_QUERY_CHARS ? `${query} job posting` : placed;
	};
}

/** Job-specific query intent belongs here, never in the generic retrieval service. */
export async function searchJobPostings(query: string, { locations, ...context }: PostingSearchContext) {
	return (await searchWeb(`${query} job posting`, context, postingQueryFor(query, { ...context, locations })))
		.filter(({ url, title }) => !isListingUrl(url) && !/\b\d[\d,]*\+?\s+(?:[\w-]+\s+){0,4}jobs\b/i.test(title))
		.map(({ url, title, snippet }) => ({
			url,
			title,
			description: snippet ?? "",
		}));
}

/** Exclude known board/search pages; unknown sites still get a chance to describe one posting. */
function isListingUrl(url: string) {
	try {
		const { hostname, pathname } = new URL(url);
		if (/(^|\.)linkedin\.com$/.test(hostname))
			return pathname.startsWith("/jobs") && !pathname.startsWith("/jobs/view/");
		if (/(^|\.)indeed\.com$/.test(hostname)) return pathname === "/jobs";
		if (/(^|\.)glassdoor\.[a-z.]+$/.test(hostname)) return pathname.startsWith("/Job/");
		if (
			/^(?:jobs\.(?:eu\.)?lever\.co|jobs\.ashbyhq\.com|(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io)$/.test(hostname)
		)
			return pathname.split("/").filter(Boolean).length < 2;
		return false;
	} catch {
		return true;
	}
}

/**
 * Where one posting lives on the common applicant tracking systems and job boards, for pages without JobPosting data.
 * The first group, when there is one, is the company's name in the address. ponytail: a fixed list; a posting anywhere
 * else counts only when its page carries JobPosting data.
 */
const POSTING_URLS = [
	/^https:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([^/]+)\/jobs\/\d+/,
	/[?&]gh_jid=\d+/,
	/^https:\/\/jobs\.(?:eu\.)?lever\.co\/([^/]+)\/[\da-f-]{36}/,
	/^https:\/\/jobs\.ashbyhq\.com\/([^/]+)\/[\da-f-]{36}/,
	/^https:\/\/apply\.workable\.com\/([^/]+)\/j\/[\da-z]+/i,
	/^https:\/\/jobs\.smartrecruiters\.com\/([^/]+)\/\d+/,
	/^https:\/\/([^/.]+)\.wd\d+\.myworkdayjobs\.com\/.+\/job\//,
	/^https:\/\/(?:[\w-]+\.)?linkedin\.com\/jobs\/view\/(?:.+-at-([\w-]+?)-)?\d+(?:[/?]|$)/,
	/^https:\/\/([^/.]+)\.recruitee\.com\/o\//,
	/^https:\/\/([^/.]+)\.jobs\.personio\.(?:de|com)\/job\/\d+/,
	/^https:\/\/([^/.]+)\.teamtailor\.com\/jobs\/\d+/,
	/^https:\/\/wellfound\.com\/jobs\/\d+/,
	/^https:\/\/www\.welcometothejungle\.com\/[a-z]{2}\/companies\/([^/]+)\/jobs\//,
];

const CLOSED =
	/no longer accepting applications|(?:job|position|posting|role) (?:is )?no longer (?:available|open)|position has been filled/i;

/**
 * One role's posting, still open: the page describes exactly one JobPosting, or sits at a posting address. A job
 * board's list, a careers page or an article is null.
 */
export async function readOpenPosting(url: string, context: WebAccessContext) {
	const { content, html = "", resolvedUrl } = await readPage(url, context);
	// The same posting published twice (an SEO plugin beside the tracking system's own) is still one role.
	const postings = jobPostingsIn(html);
	const page = postings.length === 1 && postings[0] ? readJobPosting(html) : null;
	const address = POSTING_URLS.map((pattern) => pattern.exec(resolvedUrl ?? url)).find(Boolean);
	if (postings.length > 1 || (!page && !address)) return null;
	if (page?.closesAt && new Date(page.closesAt).getTime() < Date.now()) return null;
	// ponytail: without JobPosting data, only the page's own words say a role closed; common English phrasings only.
	if (!page && CLOSED.test(content)) return null;
	return {
		page,
		text: (page?.description || content).slice(0, MAX_POSTING_CHARS),
		/** The company as its address names it ("simpleclub"), for pages without JobPosting data. */
		company: address?.[1]?.replaceAll(/[-_]+/g, " ") ?? "",
	};
}

export const readJobPosting = (html: string) => readStructuredPosting(html, htmlToText);
