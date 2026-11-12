// Keys people use to move around a page, not to type. Typing (including on a phone's on-screen keyboard) doesn't
// switch to keyboard mode, so submitting a field by tap still moves focus without a ring.
const NAVIGATION_KEYS = new Set([
	"Tab",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Escape",
	"F6",
]);

/**
 * Focus rings show only while someone navigates by keyboard. The app moves focus itself (to the page title after
 * navigation, back to a trigger when a dialog closes), and browsers ring that focus even after a tap or click.
 * `data-pointer` on <html> marks pointer use; `:focus-visible` styles skip it (globals.css). It starts set, so the
 * first route focus has no ring; the first Tab clears it.
 */
export function trackInputModality() {
	const root = document.documentElement;
	root.dataset.pointer = "";
	document.addEventListener("pointerdown", () => (root.dataset.pointer = ""), { capture: true, passive: true });
	document.addEventListener(
		"keydown",
		(event) => {
			if (NAVIGATION_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey)
				delete root.dataset.pointer;
		},
		{ capture: true },
	);
}
