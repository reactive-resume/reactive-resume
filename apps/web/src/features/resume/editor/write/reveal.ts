import type { EditorSelection } from "../store";
import { useEditorStore } from "../store";

/** The id of an entry's row in a section's list, and of its fields once it's open. */
export const entryElementId = (entryId: string) => `resume-item-${entryId}`;

/** Smooth scrolling unless the user asked for reduced motion. */
export const getScrollBehavior = (): ScrollBehavior =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";

/**
 * Page → panel, and Check's "open in Write": the panel shows what was picked (Basics for the header, a section's list,
 * an entry's fields), because the Write panel is whatever is selected.
 */
export function revealSelectionInPanel(selection: EditorSelection) {
	useEditorStore.setState({ selection });
}
