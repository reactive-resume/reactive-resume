import z from "zod";

export const webAccessProviderSchema = z.enum(["firecrawl", "tavily", "exa"]);
export type WebAccessProvider = z.infer<typeof webAccessProviderSchema>;

/** Resolved on the server for each request; never accepted as a tool input. */
export type WebAccessConnection = {
	provider: WebAccessProvider;
	apiKey?: string;
	apiUrl?: string;
};

export type WebAccessContext = {
	connection: WebAccessConnection | null;
	userId: string;
	signal?: AbortSignal | undefined;
	/** ISO 3166-1 alpha-2 countries to search, first primary. Absent or empty searches anywhere. */
	regions?: string[] | undefined;
	/** The user's UI locale, for place names written into region queries. */
	locale?: string | undefined;
	/** Installed by an authenticated caller only after approving this alternate destination. */
	fallbackSearch?:
		| ((
				query: string,
				region: string | undefined,
				signal: AbortSignal,
		  ) => Promise<{ url: string; title: string; snippet?: string }[]>)
		| undefined;
};

export type ReadPageResult = {
	requestedUrl: string;
	resolvedUrl?: string;
	content: string;
	format: "text" | "markdown";
	/** Time received by this application, not necessarily an origin fetch. */
	retrievedAt: string;
	providerFetchedAt?: string;
	method: "builtin" | WebAccessProvider;
	truncated: boolean;
	completeness: "unknown" | "incomplete";
	fallbackReason?: WebAccessFailure;
	/** Bounded server-only input for JobPosting parsing. */
	html?: string;
};

export type WebAccessFailure =
	| "unsafe-url"
	| "unreachable"
	| "not-a-page"
	| "too-large"
	| "auth"
	| "quota"
	| "malformed"
	| "empty"
	| "challenge"
	| "timeout"
	| "unavailable"
	| "rate-limit";

export class WebAccessError extends Error {
	constructor(readonly reason: WebAccessFailure) {
		super(`Web access failed (${reason}).`);
		this.name = "WebAccessError";
	}
}

export const MAX_PAGE_BYTES = 2_000_000;
export const MAX_CONTENT_CHARS = 20_000;
export const MAX_SEARCH_RESULTS = 5;
export const MAX_SEARCH_QUERY_CHARS = 512;
export const WEB_ACCESS_DEADLINE_MS = 20_000;

export type ProviderRequest = {
	connection: WebAccessConnection;
	signal: AbortSignal;
	/** One ISO 3166-1 alpha-2 country for the provider's location parameter. */
	region?: string | undefined;
};
