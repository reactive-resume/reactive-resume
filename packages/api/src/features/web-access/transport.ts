import z from "zod";
import { assertPublicPageUrl, readCapped } from "./builtin";
import { MAX_CONTENT_CHARS, MAX_PAGE_BYTES, MAX_SEARCH_RESULTS, WebAccessError } from "./contracts";

export function parseResponse<T>(schema: z.ZodType<T>, input: unknown): T {
	const parsed = schema.safeParse(input);
	if (!parsed.success) throw new WebAccessError("malformed");
	return parsed.data;
}

/** Never retain provider error bodies, which can echo credentials and request content. */
export function postJson(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
	return requestJson(
		url,
		{ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) },
		signal,
	);
}

/** The GET form of `postJson`, with the same response limits, redirect refusal and error mapping. */
export function getJson(url: string, headers: Record<string, string>, signal: AbortSignal) {
	return requestJson(url, { method: "GET", headers: { accept: "application/json", ...headers } }, signal);
}

async function requestJson(url: string, init: RequestInit, signal: AbortSignal) {
	signal.throwIfAborted();
	const response = await fetch(url, { ...init, signal, redirect: "error" });
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
	if (!response.body) throw new WebAccessError("empty");
	const text = (await readCapped(response.body, signal)).toString("utf8");
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new WebAccessError("malformed");
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
