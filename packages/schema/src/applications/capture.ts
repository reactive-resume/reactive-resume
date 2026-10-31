import z from "zod";
import { canonicalOpportunityUrl } from "./posting-url";

/** Only public posting identity survives capture; arbitrary query parameters may carry session credentials. */
export function capturePostingUrl(value: string): string {
	const canonical = canonicalOpportunityUrl(value);
	if (!canonical) return "";
	const url = new URL(canonical);
	// Unknown query values could be credentials or real job identity. Require explicit URL entry instead of guessing.
	if (
		Array.from(url.searchParams.keys()).some(
			(key) =>
				!["jk", "vjk", "gh_jid", "jobId", "jobid", "requisitionId", "id", "job", "postingId", "currentJobId"].includes(
					key,
				),
		)
	)
		return "";
	return url.toString();
}

export function captureInstallation(value: string): string {
	const url = new URL(value);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!["", "/"].includes(url.pathname) ||
		(url.protocol !== "https:" &&
			!(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
	)
		throw new Error("Use an HTTPS installation origin, or HTTP localhost for development.");
	return url.origin;
}

export const postingCaptureSchema = z.object({
	url: z.string().max(2048).transform(capturePostingUrl),
	role: z.string().trim().max(500),
	company: z.string().trim().max(500),
	location: z.string().trim().max(500),
	description: z.string().max(20_000),
	truncated: z.boolean(),
});
export type PostingCapture = z.output<typeof postingCaptureSchema>;

/** Native raw text/URL shares: reject file payloads, never resolve URLs or read attachments implicitly. */
export function captureSharedPosting(payloads: readonly { shareType: string; value: string }[]): PostingCapture | null {
	if (!payloads.length || payloads.length > 2 || payloads.some((p) => !["text", "url"].includes(p.shareType)))
		return null;
	const text = payloads.map((p) => p.value).join("\n");
	if (text.length > 100_000) return null;
	const links = [...text.matchAll(/https?:\/\/[^\s<>]+/gi)];
	const urls = [...new Set(links.map(([link]) => capturePostingUrl(link)).filter(Boolean))];
	if (urls.length > 1 || (links.length > 0 && !urls.length)) return null;
	const description = text.replace(/https?:\/\/[^\s<>]+/gi, "").trim();
	return postingCaptureSchema.parse({
		url: urls[0] ?? "",
		role: "",
		company: "",
		location: "",
		description: description.slice(0, 20_000),
		truncated: description.length > 20_000,
	});
}
