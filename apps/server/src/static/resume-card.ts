import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { getPublicResumeCardData } from "@reactive-resume/api/features/resume/social-meta";
import { env } from "@reactive-resume/env/server";
import { CARD_WIDTH, resumeCardSvg } from "@reactive-resume/pdf/web-page-card";

let ready: Promise<void> | undefined;
const initialize = () =>
	(ready ??= readFile(fileURLToPath(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))).then((bytes) =>
		initWasm(bytes),
	));

// Recent cards by what they draw; crawlers fetch a card once per share, so a small cache covers bursts.
const cache = new Map<string, Uint8Array>();
const CACHE_LIMIT = 200;

/** Where people can open the page, shortest first: its custom domain, the short link, or its own address. */
function readableAddress(username: string, slug: string, card: { isPrimary: boolean; customDomain: string | null }) {
	if (card.customDomain) return card.customDomain;
	if (card.isPrimary && env.SHORT_LINK_URL) return `${new URL(env.SHORT_LINK_URL).host}/${username}`;
	return `${new URL(env.APP_URL).host}/${username}/${slug}`;
}

/**
 * `GET /cards/<username>/<slug>.png`: the web page's link preview, drawn in the resume's fonts and colour.
 * Resumes that aren't public or need a password get the generic banner, so a card never shows what a visitor can't.
 */
export async function handleResumeCard(username: string, slug: string): Promise<Response> {
	const card = await getPublicResumeCardData({ username, slug }).catch(() => null);
	if (!card) return Response.redirect(new URL("/opengraph/banner.jpg", env.APP_URL), 302);
	const { data } = card;

	try {
		// Loaded with the first card: the PDF engine and its fonts are heavy, and most requests never need them.
		const { loadResumeCardAssets } = await import("@reactive-resume/pdf/server");
		const assets = await loadResumeCardAssets(data, env.APP_URL);
		const svg = resumeCardSvg({
			name: data.basics.name || username,
			headline: data.basics.headline,
			address: readableAddress(username, slug, card),
			color: data.metadata.design.colors.primary,
			headingFamily: assets.headingFamily,
			bodyFamily: assets.bodyFamily,
			picture: assets.picture,
		});
		const key = createHash("sha256").update(svg).digest("hex");
		let png = cache.get(key);
		if (!png) {
			await initialize();
			const resvg = new Resvg(svg, {
				fitTo: { mode: "width", value: CARD_WIDTH },
				font: { fontBuffers: assets.fonts, defaultFontFamily: assets.bodyFamily, loadSystemFonts: false },
			});
			png = resvg.render().asPng();
			resvg.free();
			if (cache.size >= CACHE_LIMIT) cache.clear();
			cache.set(key, png);
		}
		return new Response(png as Uint8Array<ArrayBuffer>, {
			headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", ETag: `"${key.slice(0, 32)}"` },
		});
	} catch (error) {
		console.error("Resume card rendering failed", error);
		return Response.redirect(new URL("/opengraph/banner.jpg", env.APP_URL), 302);
	}
}
