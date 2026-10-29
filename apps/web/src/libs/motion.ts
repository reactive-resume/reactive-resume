import type { CSSProperties } from "react";
import { MotionGlobalConfig } from "motion/react";

// Motion (JS) mirrors of the CSS motion tokens in packages/ui/src/styles/globals.css (--d1/--d2/--d3, --ease,
// --ease-in-out-strong). Durations are in seconds, Motion's unit; multiply by 1000 for APIs that take ms (dnd-kit).

/** --ease / `ease-enter`: everything entering, exiting or changing state. */
export const EASE = [0.2, 0.8, 0.2, 1] as const;
/** --ease-in-out-strong / `ease-in-out-strong`: things moving across the screen (indicators, reorder, settling). */
export const EASE_MOVE = [0.77, 0, 0.175, 1] as const;
/** --d1 / `duration-quick`: hover, press, toggle, checkbox, focus ring. */
export const D1 = 0.12;
/** --d2 / `duration-standard`: menus, popovers, expand/collapse, content swaps, dialogs. */
export const D2 = 0.2;
/** --d3 / `duration-emphasized`: side and bottom sheets, toasts, the assistant. */
export const D3 = 0.32;
/** Exits run at 70% of the enter duration, e.g. `D2 * EXIT`. */
export const EXIT = 0.7;

/** Springy, a little elastic: the mobile tab bar's marker hopping to the new tab (interruptible mid-flight). */
export const TAB_SPRING = { type: "spring", duration: 0.4, bounce: 0.3 } as const;

/** dnd-kit timing for things settling into place (sortable shuffles, drop animations): on-screen movement. */
export const DRAG_SETTLE = { duration: D2 * 1000, easing: `cubic-bezier(${EASE_MOVE.join(", ")})` };

/**
 * Hotkey mode switches land at once: the editor's mode-switch indicator skips its slide for this one change
 * (keyboard shortcuts are used too often to animate). The flag stays two frames, until the new position has painted.
 */
export function switchModeInstantly(change: () => void) {
	const list = document.querySelector<HTMLElement>('[data-slot="tabs-list"][data-mode-switch]');
	list?.setAttribute("data-instant", "");
	change();
	requestAnimationFrame(() => requestAnimationFrame(() => list?.removeAttribute("data-instant")));
}

/**
 * Something entering from nothing on its first appearance: a 4px rise and fade over D2. In a list, pair it with
 * `stagger(index)` on the same element; without it the delay is 0.
 */
export const ENTER_CLASS =
	"starting:translate-y-1 starting:opacity-0 transition-[opacity,translate] delay-(--stagger) duration-standard ease-enter motion-reduce:delay-0";

/** The index-th item of a list's first appearance: 30ms apart, capped at 150ms (the first six are staggered). */
export const stagger = (index: number) => ({ "--stagger": `${Math.min(index, 5) * 30}ms` }) as CSSProperties;

/** A status icon arriving in place (a success check, a spinner taking its slot): fades and scales up from 90% over D1. */
export const POP_CLASS = "starting:scale-90 starting:opacity-0 transition-[opacity,scale] duration-quick ease-enter";

/**
 * Reduced motion makes every duration instant (DESIGN.md, Motion). The CSS tokens drop to 1ms; Motion's own
 * `reducedMotion="user"` only drops transforms and still fades, so its animations are made instant here as well.
 */
export function followReducedMotion() {
	const query = window.matchMedia("(prefers-reduced-motion: reduce)");
	const apply = () => {
		MotionGlobalConfig.instantAnimations = query.matches;
	};
	apply();
	query.addEventListener("change", apply);
}
