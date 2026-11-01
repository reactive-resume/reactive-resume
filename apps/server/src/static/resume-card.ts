import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { getPublicResumeCardData } from "@reactive-resume/api/features/resume/social-meta";
import { env } from "@reactive-resume/env/server";
import { CARD_WIDTH, resumeCardSvg } from "@reactive-resume/pdf/web-page-card";
import { publicResumePath } from "@reactive-resume/resume/sharing";
import { matchesIfNoneMatch } from "@reactive-resume/utils/http";

let ready: Promise<void> | undefined;
const initialize = () =>
	(ready ??= readFile(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))).then((bytes) =>
		initWasm(bytes),
	));

// Recent cards by what they draw; crawlers fetch a card once per share, so a small cache covers bursts.
// ponytail: keyed on the picture's address; a new picture at the same address shows once the cache is cleared.
const cache = new Map<string, Uint8Array>();
const CACHE_LIMIT = 200;

/** Where people can open the page, as it's shared: its custom domain, or its path on the alias domain when there is one. */
function readableAddress(username: string, slug: string, card: { isPrimary: boolean; customDomain: string | null }) {
	if (card.customDomain) return card.customDomain;
	return `${new URL(env.APP_ALIAS_URL ?? env.APP_URL).host}${publicResumePath({ username, slug, isPrimary: card.isPrimary })}`;
}

const banner = () => Response.redirect(new URL("/opengraph/banner.jpg", env.APP_URL), 302);

/**
 * `GET /cards/<username>/<slug>.png`: the web page's link preview, drawn in the resume's fonts and colour.
 * Resumes that aren't public or need a password get the generic banner, so a card never shows what a visitor can't.
 */
export async function handleResumeCard(request: Request, username: string, slug: string): Promise<Response> {
	const card = await getPublicResumeCardData({ username, slug }).catch(() => null);
	if (!card) return banner();
	const { data } = card;

	const text = {
		name: data.basics.name || username,
		headline: data.basics.headline,
		address: readableAddress(username, slug, card),
		color: data.metadata.design.colors.primary,
	};
	// Everything the drawing depends on, so a repeat skips the fonts and the picture's fetch.
	const inputs = [text, data.metadata.typography, data.metadata.page.locale, data.picture.url];
	const key = createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
	const headers = {
		"Cache-Control": card.isReleasedUsername ? "no-store" : "public, max-age=3600",
		ETag: `"${key.slice(0, 32)}"`,
	};
	if (matchesIfNoneMatch(request.headers.get("if-none-match"), headers.ETag))
		return new Response(null, { status: 304, headers });

	let png = cache.get(key);
	if (!png) {
		try {
			// Loaded with the first card: the PDF engine and its fonts are heavy, and most requests never need them.
			const { loadResumeCardAssets } = await import("@reactive-resume/pdf/server");
			const assets = await loadResumeCardAssets(data, env.APP_URL);
			const svg = resumeCardSvg({
				...text,
				headingFamily: assets.headingFamily,
				bodyFamily: assets.bodyFamily,
				picture: assets.picture,
			});
			await initialize();
			const resvg = new Resvg(svg, {
				fitTo: { mode: "width", value: CARD_WIDTH },
				font: { fontBuffers: assets.fonts, defaultFontFamily: assets.bodyFamily, loadSystemFonts: false },
			});
			png = resvg.render().asPng();
			resvg.free();
			if (cache.size >= CACHE_LIMIT) cache.clear();
			// A picture that failed to load is tried again next time.
			if (!data.picture.url || assets.picture) cache.set(key, png);
		} catch (error) {
			console.error("Resume card rendering failed", error);
			return banner();
		}
	}
	return new Response(png as Uint8Array<ArrayBuffer>, { headers: { ...headers, "Content-Type": "image/png" } });
}
