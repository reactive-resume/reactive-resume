import type { RefObject } from "react";
import { useEffect } from "react";
import { create } from "zustand";

/** Each section's `data-scene` index, in page order. Scenes 0–5 are pinned; the rest scroll normally. */
export const SCENE = {
	hero: 0,
	write: 1,
	design: 2,
	check: 3,
	tailor: 4,
	share: 5,
	numbers: 6,
	languages: 7,
	support: 8,
	faq: 9,
	footer: 10,
} as const;

/**
 * The coarse state of the story. Continuous motion never goes through React: the engine below writes each section's
 * progress as the CSS variable --p and the scenes derive everything else from it with calc(). React only hears about
 * steps: which scene is on screen, which template is showing, and which controls are visible enough to use.
 */
type LandingState = {
	activeScene: number;
	reducedMotion: boolean;
	scrolled: boolean;
	/** Write: 0 while the line is typed, 1 while the assistant's comment is up, 2 once the suggestion is accepted. */
	writeStep: 0 | 1 | 2;
	/** Design: the template on top of the stack (0–4). */
	designStep: number;
	/** Design: zoomed out to the contact sheet, so the template tabs are gone. */
	designZoomed: boolean;
	/** Check: the scan's progress, in 40 steps, which drives the score and the checklist. */
	checkProgress: number;
	/** Tailor: how many of the posting's four keywords are matched. */
	keywordCount: number;
	/** Share: the visibility and copy controls are showing. */
	shareReady: boolean;
	/** Share: the night sky is up, so the header draws in light ink. */
	night: boolean;
	/** Numbers: scrolled far enough in for the digits to roll. It stays true. */
	numbersInView: boolean;
};

export const useLanding = create<LandingState>()(() => ({
	activeScene: SCENE.hero,
	reducedMotion: false,
	scrolled: false,
	writeStep: 0,
	designStep: 0,
	designZoomed: false,
	checkProgress: 0,
	keywordCount: 0,
	shareReady: false,
	night: false,
	numbersInView: false,
}));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const stepsPassed = (progress: number, thresholds: number[]) => thresholds.filter((at) => progress >= at).length;

/**
 * A section's progress through the viewport, from 0 to 1. A pinned scene counts how far its sticky stage has
 * travelled; any other section counts how much of it has come into view.
 */
export function sectionProgress(top: number, height: number, viewportHeight: number, pinned: boolean) {
	if (pinned) return clamp01(-top / Math.max(1, height - viewportHeight));
	return clamp01((viewportHeight - top) / Math.max(1, Math.min(height, viewportHeight)));
}

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

export const prefersReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;

/** Scrolls to a point within a scene, e.g. `at = 0.93` for the end of Write's accepted suggestion. */
export function goToScene(index: number, at: number) {
	const section = document.querySelector<HTMLElement>(`[data-scene="${index}"]`);
	if (!section) return;
	const rect = section.getBoundingClientRect();
	const top = rect.top + window.scrollY + at * Math.max(0, rect.height - window.innerHeight);
	window.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

/** Draws Tailor's threads from each keyword in the posting to its match on the resume, in the threads' SVG space. */
function drawThreads(section: HTMLElement) {
	const svg = section.querySelector<SVGSVGElement>("[data-threads]");
	if (!svg) return;
	const origin = svg.getBoundingClientRect();

	for (const path of svg.querySelectorAll<SVGPathElement>("[data-thread]")) {
		const key = path.dataset.thread;
		const from = section.querySelector(`[data-posting-keyword="${key}"]`)?.getBoundingClientRect();
		const to = section.querySelector(`[data-keyword="${key}"]`)?.getBoundingClientRect();
		if (!from || !to) continue;

		const sideBySide = to.left > from.right || to.right < from.left;
		if (sideBySide) {
			const leftToRight = to.left > from.right;
			const x1 = (leftToRight ? from.right + 3 : from.left - 3) - origin.left;
			const x2 = (leftToRight ? to.left - 3 : to.right + 3) - origin.left;
			const y1 = from.top + from.height / 2 - origin.top;
			const y2 = to.top + to.height / 2 - origin.top;
			const mid = (x1 + x2) / 2;
			path.setAttribute("d", `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`);
		} else {
			const x1 = from.left + from.width / 2 - origin.left;
			const x2 = to.left + to.width / 2 - origin.left;
			const y1 = from.bottom + 2 - origin.top;
			const y2 = to.top - 2 - origin.top;
			const mid = (y1 + y2) / 2;
			path.setAttribute("d", `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`);
		}
	}
}

/**
 * The scroll engine: one rAF-throttled listener that writes --p on every `[data-scene]` section inside `root`,
 * plus the few values that need layout (the contact sheet's scale, the Check lens path, Tailor's threads), and
 * publishes the coarse steps to `useLanding`. It also moves the dark-mode lamp and the hero's parallax with the mouse.
 */
export function useScrollScenes(root: RefObject<HTMLElement | null>) {
	useEffect(() => {
		const container = root.current;
		if (!container) return;

		const reducedMotion = window.matchMedia(reducedMotionQuery);
		const sections = [...container.querySelectorAll<HTMLElement>("[data-scene]")];
		const sectionAt = (index: number) => sections.find((section) => section.dataset.scene === String(index));
		// Rewriting an unchanged --p would still restyle the whole section, so only changes are written.
		const writtenProgress = new WeakMap<HTMLElement, string>();

		// Values that only change with the viewport, not with scrolling.
		const layout = () => {
			const design = sectionAt(SCENE.design);
			const stack = design?.querySelector<HTMLElement>("[data-stack]");
			if (!design || !stack) return;
			const pageWidth = stack.offsetWidth || 1;
			const scale = Math.min(
				(window.innerWidth * 0.94) / (5.48 * pageWidth),
				(window.innerHeight * 0.54) / (4.122 * pageWidth),
			);
			design.style.setProperty("--smin", scale.toFixed(4));
		};

		let frame = 0;
		let threadsDrawn = false;

		const measure = () => {
			frame = 0;
			const viewportHeight = window.innerHeight;
			const reduced = reducedMotion.matches;
			const progress: number[] = [];
			let activeScene: number = SCENE.hero;

			for (const section of sections) {
				const index = Number(section.dataset.scene);
				const rect = section.getBoundingClientRect();
				const pinned = section.dataset.pin !== undefined;
				progress[index] = reduced ? 1 : sectionProgress(rect.top, rect.height, viewportHeight, pinned);
				if (rect.top <= viewportHeight / 2 && rect.bottom > viewportHeight / 2) activeScene = index;
			}
			for (const section of sections) {
				const value = (progress[Number(section.dataset.scene)] ?? 0).toFixed(4);
				if (writtenProgress.get(section) === value) continue;
				section.style.setProperty("--p", value);
				writtenProgress.set(section, value);
			}

			const [, write1 = 0, design = 0, check = 0, tailor = 0, share = 0, numbers = 0] = progress;
			const scan = clamp01((check - 0.06) / 0.8);

			// Check's lens follows a Lissajous path down the page, unless the pointer is steering it.
			const checkSection = sectionAt(SCENE.check);
			if (checkSection && (reduced || checkSection.dataset.lensHover === undefined)) {
				checkSection.style.setProperty("--lx", `${(50 + 30 * Math.sin(scan * Math.PI * 2.5)).toFixed(2)}%`);
				checkSection.style.setProperty("--ly", `${(14 + 72 * scan).toFixed(2)}%`);
			}

			// Threads follow the keywords' real positions, so they're redrawn while Tailor is near the screen.
			const tailorSection = sectionAt(SCENE.tailor);
			const nearTailor = activeScene >= SCENE.check && activeScene <= SCENE.share;
			if (tailorSection && (nearTailor || !threadsDrawn)) {
				drawThreads(tailorSection);
				threadsDrawn = true;
			}

			const state = useLanding.getState();
			const next: Partial<LandingState> = {
				activeScene,
				reducedMotion: reduced,
				scrolled: window.scrollY > 8,
				writeStep: write1 >= 0.84 ? 2 : write1 >= 0.4 ? 1 : 0,
				designStep: stepsPassed(design, [0.15, 0.31, 0.47, 0.63]),
				designZoomed: design >= 0.84,
				checkProgress: Math.round(scan * 40) / 40,
				keywordCount: stepsPassed(tailor, [0.19, 0.31, 0.43, 0.55]),
				shareReady: share >= 0.66,
				night: activeScene === SCENE.share && (reduced || (share > 0.06 && share < 0.93)),
				numbersInView: state.numbersInView || numbers > 0.2,
			};
			const changed = (Object.keys(next) as (keyof LandingState)[]).some((key) => next[key] !== state[key]);
			if (changed) useLanding.setState(next);
		};

		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		const onResize = () => {
			layout();
			schedule();
		};

		// The pointer moves the dark-mode lamp everywhere and the hero's fragments and doodles while it's on screen.
		let pointerFrame = 0;
		let pointer = { x: 0, y: 0 };
		const onPointerMove = (event: PointerEvent) => {
			if (event.pointerType !== "mouse") return;
			pointer = { x: event.clientX, y: event.clientY };
			if (pointerFrame) return;
			pointerFrame = requestAnimationFrame(() => {
				pointerFrame = 0;
				if (reducedMotion.matches) return;
				const lamp = container.querySelector<HTMLElement>("[data-lamp]");
				lamp?.style.setProperty("--lx", `${pointer.x}px`);
				lamp?.style.setProperty("--ly", `${pointer.y}px`);
				const hero = sectionAt(SCENE.hero);
				if (hero && useLanding.getState().activeScene === SCENE.hero) {
					hero.style.setProperty("--mx", ((pointer.x / window.innerWidth) * 2 - 1).toFixed(3));
					hero.style.setProperty("--my", ((pointer.y / window.innerHeight) * 2 - 1).toFixed(3));
				}
			});
		};

		layout();
		measure();
		window.addEventListener("scroll", schedule, { passive: true });
		window.addEventListener("resize", onResize);
		window.addEventListener("pointermove", onPointerMove, { passive: true });
		reducedMotion.addEventListener("change", schedule);
		// Web fonts change the text's size, which moves the keywords the threads point at.
		void document.fonts?.ready.then(onResize);

		return () => {
			cancelAnimationFrame(frame);
			cancelAnimationFrame(pointerFrame);
			window.removeEventListener("scroll", schedule);
			window.removeEventListener("resize", onResize);
			window.removeEventListener("pointermove", onPointerMove);
			reducedMotion.removeEventListener("change", schedule);
		};
	}, [root]);
}
