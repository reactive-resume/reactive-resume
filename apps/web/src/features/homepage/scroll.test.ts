import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { goToScene, sectionProgress, useLanding } from "./scroll";

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
