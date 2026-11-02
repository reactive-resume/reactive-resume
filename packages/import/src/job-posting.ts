export type PagePosting = {
	role: string;
	company: string;
	location: string;
	description: string;
	/** The posting's own language (BCP-47), when the page declares one. */
	language: string;
	/** When the employer stops taking applications (ISO), or "". */
	closesAt: string;
};

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * JSON-LD from some boards keeps the escape as two characters, so prose contains a literal "\n". Decode only those
 * outside inline code and not themselves escaped, so a posting about `printf("\n")` keeps its example intact.
 */
export function decodeEscapedNewlines(text: string): string {
	return text.replace(/(`[^`]*`)|(?<!\\)\\r\\n|(?<!\\)\\n/g, (match, code: string | undefined) =>
		code === undefined ? "\n" : match,
	);
}

/** The document language a page declares, reduced to a plain BCP-47 tag the app can use. */
function pageLanguage(html: string): string {
	const declared = /<html[^>]*\blang\s*=\s*["']?([a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*)["']?/i.exec(html)?.[1];
	if (!declared) return "";
	try {
		return Intl.getCanonicalLocales(declared.replace(/_/g, "-"))[0] ?? "";
	} catch {
		return "";
	}
}

function readLocation(value: unknown): string {
	const place = (Array.isArray(value) ? value[0] : value) as { address?: Record<string, unknown> } | undefined;
	const address = place?.address;
	if (!address || typeof address !== "object") return "";
	return (
		[address.addressLocality, address.addressRegion, address.addressCountry]
			.map((part) => (typeof part === "object" && part ? asText((part as { name?: unknown }).name) : asText(part)))
			// "State not Applicable" and the like are placeholders, not places.
			.filter((part) => part && !/not applicable|^n\/?a$/i.test(part))
			.join(", ")
	);
}

/**
 * Every JobPosting a page describes in its JSON-LD (most job boards publish one per posting). Openers are matched with
 * bounded attributes and each body is found with indexOf, so a hostile page can't make the scan quadratic.
 */
export function jobPostingsIn(html: string): Record<string, unknown>[] {
	const scripts: string[] = [];
	const lower = html.toLowerCase();
	const opener = /<script[^<>]{0,500}type=["']application\/ld\+json["'][^<>]{0,500}>/gi;
	let match: RegExpExecArray | null;
	while ((match = opener.exec(html))) {
		const start = match.index + match[0].length;
		const end = lower.indexOf("</script>", start);
		if (end === -1) break;
		opener.lastIndex = end + "</script>".length;
		scripts.push(html.slice(start, end));
	}
	return jobPostingsFrom(scripts);
}

function jobPostingsFrom(scripts: string[]): Record<string, unknown>[] {
	const postings: Record<string, unknown>[] = [];
	for (const script of scripts) {
		let json: unknown;
		try {
			json = JSON.parse(script);
		} catch {
			continue;
		}
		const graph = (json as { "@graph"?: unknown } | null)?.["@graph"];
		const candidates = [json, ...(Array.isArray(json) ? json : []), ...(Array.isArray(graph) ? graph : [])];
		for (const item of candidates) {
			const type = (item as { "@type"?: unknown } | null)?.["@type"];
			if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))
				postings.push(item as Record<string, unknown>);
		}
	}
	// Only equivalent SEO records collapse. Same title/company alone does not identify a posting.
	return [
		...new Map(
			postings.map((item) => [
				JSON.stringify(item, (_key, value: unknown) =>
					value && typeof value === "object" && !Array.isArray(value)
						? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
						: value,
				),
				item,
			]),
		).values(),
	];
}

export function readJobPostingScripts(scripts: string[], htmlToText: (html: string) => string): PagePosting | null {
	const postings = jobPostingsFrom(scripts);
	return postings.length === 1 && postings[0] ? toPagePosting(postings[0], htmlToText) : null;
}

function declaredLanguage(value: unknown): string {
	try {
		const declared = asText(value);
		return declared ? (Intl.getCanonicalLocales(declared.replace(/_/g, "-"))[0] ?? "") : "";
	} catch {
		return "";
	}
}

/** Some boards escape the description's HTML ("&lt;p&gt;"), so the first pass leaves tags behind. */
const richText = (html: string, htmlToText: (html: string) => string) => {
	const text = htmlToText(html);
	return /<\/?[a-z][^<>]*>/i.test(text) ? htmlToText(text) : text;
};

function toPagePosting(posting: Record<string, unknown>, htmlToText: (html: string) => string): PagePosting {
	const organization = posting.hiringOrganization as { name?: unknown } | string | undefined;
	const remote = asText(posting.jobLocationType).toUpperCase() === "TELECOMMUTE";
	return {
		role: asText(posting.title),
		company: typeof organization === "string" ? organization.trim() : asText(organization?.name),
		location: [readLocation(posting.jobLocation), remote ? "Remote" : ""].filter(Boolean).join(" · "),
		description: decodeEscapedNewlines(richText(asText(posting.description), htmlToText)),
		language: declaredLanguage(posting.inLanguage),
		closesAt: asText(posting.validThrough),
	};
}

/**
 * The JobPosting a page describes in its JSON-LD, read without any AI: title, hiring organisation, location and the
 * description as text.
 */
export function readJobPosting(html: string, htmlToText: (html: string) => string): PagePosting | null {
	const postings = jobPostingsIn(html);
	if (postings.length !== 1 || !postings[0]) return null;
	const page = toPagePosting(postings[0], htmlToText);
	return page.language ? page : { ...page, language: pageLanguage(html) };
}
