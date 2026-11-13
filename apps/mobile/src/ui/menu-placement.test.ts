// MOTION.md §6.5 menus: below the trigger when it fits, above when only that side fits, else the larger side scrolls.
import { placeMenu } from "./Menu";

const bounds = { top: 59, bottom: 700 };
const anchor = (y: number) => ({ x: 24, y, width: 342, height: 44 });

test("opens below the trigger when it fits", () => {
	expect(placeMenu(anchor(100), 200, bounds)).toEqual({ top: 152, height: 200, below: true, scroll: false });
});

test("flips above when the space below the trigger is too short", () => {
	expect(placeMenu(anchor(620), 200, bounds)).toEqual({ top: 412, height: 200, below: false, scroll: false });
});

test("takes the larger side and scrolls when neither side fits", () => {
	expect(placeMenu(anchor(500), 632, bounds)).toEqual({ top: 59, height: 433, below: false, scroll: true });
	expect(placeMenu(anchor(150), 632, bounds)).toEqual({ top: 202, height: 498, below: true, scroll: true });
});

test("an unknown height opens below", () => {
	expect(placeMenu(anchor(620), 0, bounds).below).toBe(true);
});
