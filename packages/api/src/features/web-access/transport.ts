import z from "zod";
import { assertPublicPageUrl } from "./builtin";
import { MAX_CONTENT_CHARS, MAX_PAGE_BYTES, MAX_SEARCH_RESULTS, WebAccessError } from "./contracts";

export function parseResponse<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw new WebAccessError("malformed");
	return parsed.data;
}

/** Never retain provider error bodies, which can echo credentials and request content. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
	signal.throwIfAborted();
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
		signal,
		redirect: "error",
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new WebAccessError(
			response.status === 401 || response.status === 403
				? "auth"
				: response.status === 429 || response.status === 402
					? "quota"
					: "unreachable",
		);
	}
	if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES) {
		await response.body?.cancel();
		throw new WebAccessError("too-large");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new WebAccessError("empty");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_PAGE_BYTES) throw new WebAccessError("too-large");
			chunks.push(value);
		}
		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
		} catch {
			throw new WebAccessError("malformed");
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

const searchItemSchema = z.object({ url: z.string(), title: z.string(), snippet: z.string().optional() });
export function normalizeSearch(items: unknown[]) {
	return items
		.flatMap((item) => {
			const result = searchItemSchema.safeParse(item);
			if (!result.success) return [];
			try {
				return [
					{
						url: assertPublicPageUrl(result.data.url).toString(),
						title: result.data.title.slice(0, 1_000),
						...(result.data.snippet ? { snippet: result.data.snippet.slice(0, 5_000) } : {}),
					},
				];
			} catch {
				return [];
			}
		})
		.slice(0, MAX_SEARCH_RESULTS);
}

export function pageContent(content: string) {
	const text = content.trim();
	if (!text) throw new WebAccessError("empty");
	const opening = text.split("\n", 1)[0]?.replace(/^#{1,6}\s*/, "") ?? "";
	if (
		text.length < 3_000 &&
		/^(?:just a moment(?:[.!…]|$)|checking your browser\b|verify (?:that )?you(?:'re| are) human\b|access denied(?:[.!:]|$)|enable javascript and cookies\b|captcha challenge(?:[.!:]|$))/i.test(
			opening,
		)
	) {
		throw new WebAccessError("challenge");
	}
	const truncated = text.length > MAX_CONTENT_CHARS;
	return {
		content: text.slice(0, MAX_CONTENT_CHARS),
		truncated,
		completeness:
			truncated || /\[(?:content )?(?:truncated|\.\.\.)\]\s*$/i.test(text)
				? ("incomplete" as const)
				: ("unknown" as const),
	};
}

export function safeFailure(error: unknown, signal: AbortSignal) {
	if (signal.aborted) {
		if ((signal.reason as { name?: string } | undefined)?.name === "TimeoutError") return new WebAccessError("timeout");
		throw signal.reason;
	}
	return error instanceof WebAccessError ? error : new WebAccessError("unreachable");
}
