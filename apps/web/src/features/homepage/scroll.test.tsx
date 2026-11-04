// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useRef } from "react";
import { goToScene, SCENE, sectionExitProgress, sectionProgress, useLanding, useScrollScenes } from "./scroll";

describe("section progress", () => {
	it("measures a pinned scene by how far its sticky stage has travelled", () => {
		// A 3000px scene in a 1000px viewport pins for 2000px of scrolling.
		expect(sectionProgress(200, 3000, 1000, true)).toBe(0);
		expect(sectionProgress(-1000, 3000, 1000, true)).toBe(0.5);
		expect(sectionProgress(-2600, 3000, 1000, true)).toBe(1);
	});

	it("measures any other section by how much of it has come into view", () => {
		expect(sectionProgress(1000, 600, 1000, false)).toBe(0);
		expect(sectionProgress(700, 600, 1000, false)).toBe(0.5);
		expect(sectionProgress(-50, 2400, 1000, false)).toBe(1);
	});
});

describe("scene exit", () => {
	it("runs from the section's bottom reaching the fold to its bottom passing the top", () => {
		expect(sectionExitProgress(1000, 1000)).toBe(0);
		expect(sectionExitProgress(500, 1000)).toBe(0.5);
		expect(sectionExitProgress(0, 1000)).toBe(1);
		expect(sectionExitProgress(-400, 1000)).toBe(1);
	});
});

describe("scroll engine", () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		useLanding.setState({ designExiting: false });
	});

	it.each(["light", "dark"])("warms newly visible images in an already nearby scene after %s mode", async (initial) => {
		let theme = initial;
		const decoded: (string | null)[] = [];
		vi.stubGlobal("innerHeight", 900);
		vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const top = this.dataset.scene === String(SCENE.footer) ? 1700 : 9000;
			return { top, bottom: top + 800, height: 800, width: 0 } as DOMRect;
		});
		vi.spyOn(HTMLElement.prototype, "checkVisibility").mockImplementation(function (this: HTMLElement) {
			return this.dataset.theme === theme;
		});
		vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(function (this: HTMLImageElement) {
			decoded.push(this.getAttribute("src"));
			return Promise.resolve();
		});
		function Scenes() {
			const root = useRef<HTMLDivElement>(null);
			useScrollScenes(root);
			return (
				<div ref={root}>
					<section data-scene={SCENE.write} data-pin>
						<img alt="" src="/far.webp" data-theme="light" />
					</section>
					<section data-scene={SCENE.footer}>
						<img alt="" src="/desk-light.webp" data-theme="light" />
						<img alt="" src="/desk-dark.webp" data-theme="dark" />
					</section>
				</div>
			);
		}
		render(<Scenes />);
		await waitFor(() => expect(decoded).toEqual([`/desk-${initial}.webp`]));
		theme = initial === "light" ? "dark" : "light";
		fireEvent.scroll(window);
		await waitFor(() => expect(decoded).toEqual([`/desk-${initial}.webp`, `/desk-${theme}.webp`]));
		fireEvent.scroll(window);
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		expect(decoded).toHaveLength(2);
	});

	it("keeps header progress and ink local while Share keeps its own night", async () => {
		let shareTop = -450;
		const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
		vi.stubGlobal("innerHeight", 900);
		vi.stubGlobal("matchMedia", () => motion);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const top = this.dataset.scene === String(SCENE.share) ? shareTop : 0;
			return { top, bottom: top + 1800, height: 1800, width: 0 } as DOMRect;
		});
		function Scenes() {
			const root = useRef<HTMLDivElement>(null);
			useScrollScenes(root);
			return (
				<div ref={root} data-testid="landing">
					<header className="night-ink" />
					<button type="button" className="night-ink">
						Lamp
					</button>
					<section data-scene={SCENE.share} data-pin />
				</div>
			);
		}
		const { getByRole, getByTestId } = render(<Scenes />);
		const root = getByTestId("landing");
		const header = getByRole("banner");
		const lamp = getByRole("button", { name: "Lamp" });
		const share = root.querySelector<HTMLElement>("section");
		if (!share) throw new Error("The scene harness did not render.");
		await waitFor(() => expect(header.style.getPropertyValue("--sp")).toBe("0.500"));
		expect(header.style.getPropertyValue("--nt")).toBe("1.000");
		expect(lamp.style.getPropertyValue("--nt")).toBe("1.000");
		expect(share.style.getPropertyValue("--nt")).toBe("1.000");
		expect(root.style.getPropertyValue("--sp")).toBe("");
		expect(root.style.getPropertyValue("--nt")).toBe("");

		shareTop = -1350;
		motion.matches = true;
		fireEvent.scroll(window);
		await waitFor(() => expect(header.style.getPropertyValue("--nt")).toBe("0.000"));
		expect(lamp.style.getPropertyValue("--nt")).toBe("0.000");
		expect(Number(share.style.getPropertyValue("--nt"))).toBeGreaterThan(0.9);
	});

	it("writes exit progress on pinned scenes and reports when Design hands its heading off", async () => {
		const rects = new Map<string, { top: number; bottom: number; height: number }>([
			[String(SCENE.design), { top: 0, bottom: 315, height: 900 }],
			[String(SCENE.check), { top: 0, bottom: 0, height: 900 }],
		]);
		vi.stubGlobal("innerHeight", 900);
		vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
			const rect = rects.get(this.dataset.scene ?? "") ?? { top: 0, bottom: 0, height: 0 };
			return {
				...rect,
				left: 0,
				right: 0,
				width: 0,
				x: 0,
				y: 0,
				toJSON: () => ({}),
			} as DOMRect;
		});

		function Scenes() {
			const root = useRef<HTMLDivElement>(null);
			useScrollScenes(root);
			return (
				<div ref={root}>
					<section data-scene={SCENE.design} data-pin />
					<section data-scene={SCENE.check} data-pin />
					<section data-scene={SCENE.tailor} />
				</div>
			);
		}

		render(<Scenes />);
		const design = document.querySelector<HTMLElement>(`[data-scene="${SCENE.design}"]`);
		const check = document.querySelector<HTMLElement>(`[data-scene="${SCENE.check}"]`);
		const tailor = document.querySelector<HTMLElement>(`[data-scene="${SCENE.tailor}"]`);
		if (!design || !check || !tailor) throw new Error("The scene harness did not render.");

		await waitFor(() => expect(design.style.getPropertyValue("--out")).toBe("0.650"));
		expect(useLanding.getState().designExiting).toBe(false);
		expect(check.style.getPropertyValue("--out")).toBe("1.000");
		expect(tailor.style.getPropertyValue("--out")).toBe("");

		// Raw 0.6596 rounds to the same 0.660 the heading uses, so the link must already be exiting.
		rects.set(String(SCENE.design), { top: 0, bottom: 306.36, height: 900 });
		fireEvent.scroll(window);
		await waitFor(() => expect(design.style.getPropertyValue("--out")).toBe("0.660"));
		expect(useLanding.getState().designExiting).toBe(true);

		rects.set(String(SCENE.design), { top: 0, bottom: 600, height: 900 });
		fireEvent.scroll(window);
		await waitFor(() => expect(design.style.getPropertyValue("--out")).toBe("0.333"));
		expect(useLanding.getState().designExiting).toBe(false);
	});
});

describe("scene navigation", () => {
	afterEach(() => vi.unstubAllGlobals());
	it.each(["wheel", "touchmove", "PageDown", "ArrowDown", " ", "a"])(
		"respects %s input during a pending scene jump",
		async (input) => {
			const scrollTo = vi.fn();
			const target = Object.assign(new EventTarget(), {
				scrollY: 0,
				innerHeight: 900,
				scrollTo,
				matchMedia: () => ({ matches: false }),
			});
			let update = () => {};
			let finish = () => {};
			const updateCallbackDone = new Promise<void>((resolve) => (finish = resolve));
			vi.stubGlobal("CSS", { supports: () => true });
			vi.stubGlobal("window", target);
			vi.stubGlobal("document", {
				querySelector: () => ({ getBoundingClientRect: () => ({ top: 6000, height: 900 }) }),
				startViewTransition: (options: { update: () => void }) => {
					update = options.update;
					return { updateCallbackDone };
				},
			});
			useLanding.setState({ activeScene: 0 });
			goToScene(6, 0);
			target.dispatchEvent(
				input === "wheel" || input === "touchmove"
					? new Event(input)
					: Object.assign(new Event("keydown"), { key: input }),
			);
			update();
			finish();
			await updateCallbackDone;
			if (input === "a") expect(scrollTo).toHaveBeenCalledWith({ top: 6000, behavior: "instant" });
			else expect(scrollTo).not.toHaveBeenCalled();
		},
	);
	it("keeps the last destination when an earlier view-transition update arrives late", () => {
		const scrollTo = vi.fn();
		const updates: (() => void)[] = [];
		vi.stubGlobal("CSS", { supports: () => true });
		vi.stubGlobal(
			"window",
			Object.assign(new EventTarget(), {
				scrollY: 0,
				innerHeight: 900,
				scrollTo,
				matchMedia: () => ({ matches: false }),
			}),
		);
		vi.stubGlobal("document", {
			querySelector: (selector: string) => ({
				getBoundingClientRect: () => ({ top: selector.includes('"6"') ? 6000 : 1000, height: 900 }),
			}),
			startViewTransition: ({ update }: { update: () => void }) => {
				updates.push(update);
				return { updateCallbackDone: Promise.resolve() };
			},
		});
		useLanding.setState({ activeScene: 0 });
		goToScene(6, 0);
		goToScene(1, 0);
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: "smooth" });
		updates[0]?.();
		expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: "smooth" });
	});
});
