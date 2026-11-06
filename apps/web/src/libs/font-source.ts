// The root loader installs the instance's public configuration before rendering any app UI.
// Keep this in the browser app: shared renderers receive a captured value, including across the worker boundary.
let fontMirrorUrl: string | undefined;

export function configureFontMirror(value: string | undefined) {
	fontMirrorUrl = value;
}

export function getFontMirrorUrl() {
	return fontMirrorUrl;
}
