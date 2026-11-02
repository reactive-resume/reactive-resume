let region: HTMLElement | null = null;

/**
 * Says a message to screen readers through one shared polite live region (for changes that move focus with them,
 * such as a keyboard reorder, where nothing else on screen announces the result).
 */
export function announce(message: string) {
	if (!region?.isConnected) {
		region = document.createElement("div");
		region.setAttribute("role", "status");
		region.setAttribute("aria-live", "polite");
		region.className = "sr-only";
		document.body.append(region);
	}
	const target = region;
	// Cleared first, so the same message twice in a row is still read.
	target.textContent = "";
	requestAnimationFrame(() => {
		target.textContent = message;
	});
}
