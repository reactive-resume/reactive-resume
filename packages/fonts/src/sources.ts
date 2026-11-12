/** Public, operator-controlled mirror address. Never read deployment environment in this package. */
export function normalizeFontMirrorUrl(value: string): string {
	const url = new URL(value.trim());
	if (!/^https?:$/.test(url.protocol) || url.username || url.password || /[?#]/.test(value))
		throw new Error("Font mirror URL must be HTTP(S), without credentials, a query or a fragment.");
	return url.href.replace(/\/+$/, "");
}

/** Stable on-disk layout shared by mirror preparation, font previews and every renderer. */
export function fontMirrorPath(source: string): string {
	const url = new URL(source);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!["fonts.gstatic.com", "fonts.gstatic.cn", "cdn.jsdelivr.net"].includes(url.host)
	)
		throw new Error("Unsupported catalog font source.");
	return `${url.hostname.replace("fonts.gstatic.cn", "fonts.gstatic.com")}${url.pathname}`;
}

/** A configured mirror owns every catalog font, including script and symbol fallbacks. */
export function resolveFontSource(source: string, mirrorUrl?: string): string {
	return mirrorUrl ? `${normalizeFontMirrorUrl(mirrorUrl)}/${fontMirrorPath(source)}` : source;
}
