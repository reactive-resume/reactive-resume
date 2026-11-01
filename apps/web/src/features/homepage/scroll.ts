import type { RefObject } from "react";
import { useEffect } from "react";
import { create } from "zustand";

/** Each section's `data-scene` index, in page order. Scenes 0–6 are pinned; the rest scroll normally. */
export const SCENE = {
	hero: 0,
	write: 1,
	design: 2,
	check: 3,
	tailor: 4,
	share: 5,
	prepare: 6,
	remember: 7,
	numbers: 8,
	languages: 9,
	support: 10,
	faq: 11,
	footer: 12,
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
	/** Share: the night sky is more than half up, so the header shows its light logo. The ink itself follows --nt. */
	night: boolean;
	/** Prepare: the workspace tab on show (0 Messages, 1 Fit, 2 Prepare, 3 Practise, 4 the interview, 5 Debrief). */
	prepareStep: number;
	/** Prepare: the clock, in minutes since midnight, to the nearest five. */
	prepareClock: number;
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
	prepareStep: 0,
	prepareClock: 9 * 60,
	numbersInView: false,
}));

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Where Prepare moves on to its next tab: Fit, Prepare, Practise, the interview itself and Debrief. */
const PREPARE_STEPS = [0.19, 0.36, 0.53, 0.7, 0.84];

const smoothstep = (value: number) => value * value * (3 - 2 * value);

/**
 * How dark Share's sky is, from 0 to 1: night falls over the scene's first fifth and lifts into dawn over its last
 * stretch, both eased, so neither end snaps. The engine writes it as --nt on Share and on the page, for the header.
 */
function shareNight(progress: number) {
	return smoothstep(clamp01((progress - 0.02) / 0.22)) * (1 - smoothstep(clamp01((progress - 0.72) / 0.28)));
}

/**
 * Prepare's clock, in minutes since midnight: the reply lands at 09:00, the day runs to the interview at 17:30, holds
 * there, then moves on to 19:00 for the debrief once the pause is over.
 */
export const INTERVIEW_AT = 17 * 60 + 30;
function prepareMinutes(progress: number) {
	return 9 * 60 + 510 * clamp01((progress - 0.16) / 0.54) + 90 * clamp01((progress - 0.84) / 0.1);
}

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

let sceneNavigation = 0;
let stopSceneNavigation: (() => void) | undefined;
const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

const supportsTransitionTypes = () => globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))") === true;

/**
 * Scrolls to a point within a scene, e.g. `at = 0.93` for the end of Write's accepted suggestion. Within a scene or to
 * the next one it scrolls smoothly, since scrubbing through is the story. A longer jump cuts straight there instead of
 * fast-forwarding through every scene between, fading through like a page change (index.css) where the browser can.
 * Reduced motion always cuts.
 */
export function goToScene(index: number, at: number) {
	const section = document.querySelector<HTMLElement>(`[data-scene="${index}"]`);
	if (!section) return;
	stopSceneNavigation?.();
	const rect = section.getBoundingClientRect();
	const top = rect.top + window.scrollY + at * Math.max(0, rect.height - window.innerHeight);
	const navigation = ++sceneNavigation;
	const cut = () => {
		if (navigation === sceneNavigation) window.scrollTo({ top, behavior: "instant" });
	};

	if (prefersReducedMotion()) return cut();
	if (Math.abs(index - useLanding.getState().activeScene) <= 1) return window.scrollTo({ top, behavior: "smooth" });
	if (!document.startViewTransition || !supportsTransitionTypes()) return cut();
	const controller = new AbortController();
	const cleanup = () => {
		controller.abort();
		if (stopSceneNavigation === cleanup) stopSceneNavigation = undefined;
	};
	const interrupt = (event: Event) => {
		if (event.type === "keydown" && !scrollKeys.has((event as KeyboardEvent).key)) return;
		sceneNavigation++;
		cleanup();
	};
	stopSceneNavigation = cleanup;
	for (const type of ["wheel", "touchmove", "keydown"])
		window.addEventListener(type, interrupt, { passive: true, signal: controller.signal });
	const transition = document.startViewTransition({ update: cut, types: ["page"] });
	void transition.updateCallbackDone.then(cleanup, cleanup);
}

/**
 * Renders a pinned scene and decodes its images while it's still a screen or two away, so its first frame on screen
 * isn't the one that pays for them. Scenes further off go back to skipping their rendering (landing.css).
 */
function warmScenes(sections: HTMLElement[], nearby: Set<number>, decoded: WeakSet<HTMLElement>) {
	for (const section of sections) {
		const near = nearby.has(Number(section.dataset.scene));
		if (section.dataset.pin !== undefined && near !== (section.dataset.warm !== undefined))
			section.toggleAttribute("data-warm", near);
		if (!near || decoded.has(section)) continue;
		decoded.add(section);
		for (const image of section.querySelectorAll("img")) {
			// Only the drawing for the current theme: the other one is display: none.
			if (typeof image.checkVisibility === "function" && !image.checkVisibility()) continue;
			image.loading = "eager";
			void image.decode().catch(() => undefined);
		}
	}
}

/**
 * Draws Tailor's threads from each keyword in the posting to its match on the resume, in the threads' SVG space. A
 * thread runs from the posting card's edge to the page's, level with each phrase, so it never crosses the words.
 * Below 900px the card sits above the page and the threads are hidden; the highlights still pair up.
 */
function drawThreads(section: HTMLElement) {
	const svg = section.querySelector<SVGSVGElement>("[data-threads]");
	const card = section.querySelector("[data-thread-from]")?.getBoundingClientRect();
	const page = section.querySelector("[data-thread-to]")?.getBoundingClientRect();
	if (!svg || !card || !page) return;
	const origin = svg.getBoundingClientRect();
	const leftToRight = page.left > card.right;

	const paths: { path: SVGPathElement; d: string }[] = [];
	for (const path of svg.querySelectorAll<SVGPathElement>("[data-thread]")) {
		const key = path.dataset.thread;
		const from = section.querySelector(`[data-posting-keyword="${key}"]`)?.getBoundingClientRect();
		const to = section.querySelector(`[data-keyword="${key}"]`)?.getBoundingClientRect();
		if (!from || !to) continue;

		const x1 = (leftToRight ? card.right + 2 : card.left - 2) - origin.left;
		const x2 = (leftToRight ? page.left - 2 : page.right + 2) - origin.left;
		const y1 = from.top + from.height / 2 - origin.top;
		const y2 = to.top + to.height / 2 - origin.top;
		const mid = (x1 + x2) / 2;
		paths.push({ path, d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}` });
	}
	// Read every anchor before writing SVG geometry, avoiding a layout flush between threads.
	for (const { path, d } of paths) path.setAttribute("d", d);
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

		// Where Check's lens comes to rest, as a share of its page: over the date line it flags.
		let lensPark = { x: 60, y: 50 };

		const decodedScenes = new WeakSet<HTMLElement>();

		// Values that only change with the viewport, not with scrolling.
		const measuredScenes = new Set<number>();
		const layout = (nearby: Set<number>) => {
			const check = nearby.has(SCENE.check) && !measuredScenes.has(SCENE.check) ? sectionAt(SCENE.check) : undefined;
			const lensPage = check?.querySelector("[data-lens-page]")?.getBoundingClientRect();
			const park = check?.querySelector("[data-park]")?.getBoundingClientRect();
			if (lensPage && park && lensPage.width > 0) {
				lensPark = {
					x: ((park.left + park.width / 2 - lensPage.left) / lensPage.width) * 100,
					y: ((park.top + park.height / 2 - lensPage.top) / lensPage.height) * 100,
				};
				measuredScenes.add(SCENE.check);
			}

			// Write's two lines and the comment keep their full height; the scene clips and translates by these instead of
			// reflowing (write.tsx). Below 1280px the comment sits under the lines, above it beside them.
			const write = nearby.has(SCENE.write) && !measuredScenes.has(SCENE.write) ? sectionAt(SCENE.write) : undefined;
			const oldLine = write?.querySelector<HTMLElement>("[data-line-old]");
			const newLine = write?.querySelector<HTMLElement>("[data-line-new]");
			const comment = write?.querySelector<HTMLElement>("[data-write-comment]");
			if (write && oldLine && newLine && comment) {
				const inline = window.innerWidth < 1280;
				write.style.setProperty("--oh", `${oldLine.offsetHeight}px`);
				write.style.setProperty("--nh", `${newLine.offsetHeight}px`);
				write.style.setProperty("--cmh-inline", inline ? `${comment.offsetHeight}px` : "0px");
				write.style.setProperty("--cmh-side", inline ? "0px" : `${comment.offsetHeight}px`);
				measuredScenes.add(SCENE.write);
			}

			const design =
				nearby.has(SCENE.design) && !measuredScenes.has(SCENE.design) ? sectionAt(SCENE.design) : undefined;
			const stack = design?.querySelector<HTMLElement>("[data-stack]");
			if (!design || !stack) return;
			const pageWidth = stack.offsetWidth || 1;
			// Six columns and three rows of pages, 0.12 of a page apart, kept clear of the closing line beneath.
			const scale = Math.min(
				(window.innerWidth * 0.94) / (6.6 * pageWidth),
				(window.innerHeight * 0.57) / (4.122 * pageWidth),
			);
			design.style.setProperty("--smin", scale.toFixed(4));
			measuredScenes.add(SCENE.design);
		};

		let frame = 0;
		let writtenClock = "";
		let writtenNight = "";

		const measure = () => {
			frame = 0;
			const viewportHeight = window.innerHeight;
			const reduced = reducedMotion.matches;
			const progress: number[] = [];
			const nearby = new Set<number>();
			let activeScene: number = SCENE.hero;

			for (const section of sections) {
				const index = Number(section.dataset.scene);
				const rect = section.getBoundingClientRect();
				if (rect.top < viewportHeight * 2 && rect.bottom > -viewportHeight) nearby.add(index);
				const pinned = section.dataset.pin !== undefined;
				progress[index] = reduced ? 1 : sectionProgress(rect.top, rect.height, viewportHeight, pinned);
				if (rect.top <= viewportHeight / 2 && rect.bottom > viewportHeight / 2) activeScene = index;
			}
			warmScenes(sections, nearby, decodedScenes);
			// Descendant geometry would force content-visibility to render an offscreen scene.
			layout(nearby);
			// The footer's desk paints itself in as it scrolls up, finishing exactly when the page ends.
			const desk = nearby.has(SCENE.footer)
				? sectionAt(SCENE.footer)?.querySelector<HTMLElement>(".footer-desk")
				: null;
			if (desk) {
				const rect = desk.getBoundingClientRect();
				// The desk ends the page, so its bottom meets the screen's bottom exactly when scrolling ends.
				const value = reduced ? "1" : clamp01((viewportHeight - rect.top) / Math.max(1, rect.height)).toFixed(3);
				if (desk.style.getPropertyValue("--dp") !== value) desk.style.setProperty("--dp", value);
			}
			const tailorSection = sectionAt(SCENE.tailor);
			if (tailorSection && nearby.has(SCENE.tailor) && window.innerWidth >= 900) drawThreads(tailorSection);
			for (const section of sections) {
				const value = (progress[Number(section.dataset.scene)] ?? 0).toFixed(4);
				if (writtenProgress.get(section) === value) continue;
				section.style.setProperty("--p", value);
				writtenProgress.set(section, value);
			}

			const at = (scene: number) => progress[scene] ?? 0;
			const scan = clamp01((at(SCENE.check) - 0.06) / 0.8);
			const prepare = at(SCENE.prepare);

			// Prepare's clock hands turn with the scroll; the minutes are written once, here, for the CSS and the readout.
			const minutes = prepareMinutes(prepare);
			// Share's night: on the scene for its sky, and on the page while Share is on screen, for the header's ink.
			const night = reduced ? 1 : shareNight(at(SCENE.share));
			const pageNight = (activeScene === SCENE.share ? night : 0).toFixed(3);
			if (`${night.toFixed(3)}|${pageNight}` !== writtenNight) {
				sectionAt(SCENE.share)?.style.setProperty("--nt", night.toFixed(3));
				container.style.setProperty("--nt", pageNight);
				writtenNight = `${night.toFixed(3)}|${pageNight}`;
			}

			const prepareSection = sectionAt(SCENE.prepare);
			const clock = minutes.toFixed(1);
			if (prepareSection && clock !== writtenClock) {
				prepareSection.style.setProperty("--t", clock);
				writtenClock = clock;
			}

			// Check's lens wanders down the page to the date line it flags and rests there while the fix lands, unless
			// the pointer is steering it.
			const checkSection = sectionAt(SCENE.check);
			if (checkSection && nearby.has(SCENE.check) && (reduced || checkSection.dataset.lensHover === undefined)) {
				const approach = clamp01(scan / 0.45);
				const settle = clamp01((approach - 0.6) / 0.4);
				const ease = settle * settle * (3 - 2 * settle);
				const wander = 50 + 30 * Math.sin(approach * Math.PI * 2);
				checkSection.style.setProperty("--lx", `${(wander + (lensPark.x - wander) * ease).toFixed(2)}%`);
				checkSection.style.setProperty("--ly", `${(14 + (lensPark.y - 14) * approach).toFixed(2)}%`);
			}

			const state = useLanding.getState();
			const next: Partial<LandingState> = {
				activeScene,
				reducedMotion: reduced,
				scrolled: window.scrollY > 8,
				writeStep: at(SCENE.write) >= 0.84 ? 2 : at(SCENE.write) >= 0.4 ? 1 : 0,
				designStep: stepsPassed(at(SCENE.design), [0.15, 0.31, 0.47, 0.63]),
				designZoomed: at(SCENE.design) >= 0.84,
				checkProgress: Math.round(scan * 40) / 40,
				keywordCount: stepsPassed(at(SCENE.tailor), [0.19, 0.31, 0.43, 0.55]),
				shareReady: at(SCENE.share) >= 0.66,
				night: Number(pageNight) > 0.5,
				prepareStep: stepsPassed(prepare, PREPARE_STEPS),
				prepareClock: Math.round(minutes / 5) * 5,
				numbersInView: state.numbersInView || at(SCENE.numbers) > 0.2,
			};
			const changed = (Object.keys(next) as (keyof LandingState)[]).some((key) => next[key] !== state[key]);
			if (changed) useLanding.setState(next);
		};

		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(measure);
		};
		const onResize = () => {
			measuredScenes.clear();
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
