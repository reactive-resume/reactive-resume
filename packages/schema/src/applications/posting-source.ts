import type { PostingSource } from "./data";
import { formatReadTime } from "@reactive-resume/utils/timezone";

/** Only retained retrieval metadata can name when and where a page was read; an edited job link cannot. */
export function postingReadReceipt(source: PostingSource | null | undefined, locale: string, tick = Date.now()) {
	if (!source || source.method === "paste" || !source.retrievedAt) return null;
	// A tick invalidates client memoization; a newly completed read can be later than that tick.
	const readAt = formatReadTime(source.retrievedAt, locale, Math.max(tick, Date.now()));
	if (!readAt) return null;
	let sourceHost: string | null = null;
	try {
		const url = new URL(source.resolvedUrl ?? source.requestedUrl ?? "");
		if (url.protocol === "https:" || url.protocol === "http:") sourceHost = url.hostname;
	} catch {
		// Older saved postings may have a read time without a retained URL.
	}
	return { readAt, sourceHost };
}
