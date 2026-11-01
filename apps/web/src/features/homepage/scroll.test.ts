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
	it("keeps the last destination when an earlier view-transition update arrives late", () => {
		const scrollTo = vi.fn();
		const updates: (() => void)[] = [];
		vi.stubGlobal("CSS", { supports: () => true });
		vi.stubGlobal("window", { scrollY: 0, innerHeight: 900, scrollTo, matchMedia: () => ({ matches: false }) });
		vi.stubGlobal("document", {
			querySelector: (selector: string) => ({
				getBoundingClientRect: () => ({ top: selector.includes('"6"') ? 6000 : 1000, height: 900 }),
			}),
			startViewTransition: ({ update }: { update: () => void }) => {
				updates.push(update);
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
