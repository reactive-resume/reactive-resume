const TOKEN_ATTRIBUTES = ["fill", "stroke", "stop-color"] as const;

/**
 * An SVG rasterized through an `<img>` cannot read the page's CSS variables, so a clone would lose every `var(--…)`
 * fill in its PNG. Resolve those attributes to their computed values at the export boundary; the on-screen chart keeps
 * the tokens, and both the light and dark values come from the same theme the reader sees.
 */
export function resolveExportTokens(
	svg: SVGSVGElement,
	readToken: (token: string) => string = (token) =>
		getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
) {
	for (const element of [svg, ...svg.querySelectorAll<SVGElement>("*")]) {
		for (const attribute of TOKEN_ATTRIBUTES) {
			const value = element.getAttribute(attribute);
			if (!value?.includes("var(")) continue;
			element.setAttribute(
				attribute,
				value.replace(/var\((--[\w-]+)\)/g, (_, token: string) => readToken(token) || "currentColor"),
			);
		}
	}
}
