// MOTION.md §5, §7 and §10.2: each control plays exactly its haptics for one interaction, through the same
// functions the components call.
import { edgeZone } from "./BoardDrag";
import { stripShouldOpen } from "./ExpandingStrip";
import { clearHapticLog, hapticLog } from "./motion";
import { selectRadio } from "./Radio";
import { reorderSlots } from "./ReorderList";
import { selectSegment } from "./Segmented";
import { snapTarget } from "./SnapCarousel";
import { swipeArm } from "./SwipeRow";
import { toggleValue } from "./Switch";

jest.mock("@lingui/core", () => ({ i18n: { _: (d: { message?: string; id: string }) => d.message ?? d.id } }));

const log = () => hapticLog().map((e) => e.token);
beforeEach(() => clearHapticLog());

test("Switch: toggleOn turning on, toggleOff turning off", () => {
	const set = jest.fn();
	toggleValue(false, set);
	toggleValue(true, set);
	expect(log()).toEqual(["toggleOn", "toggleOff"]);
	expect(set.mock.calls).toEqual([[true], [false]]);
});

test("Segmented: selection on a change, nothing for the selected option", () => {
	const change = jest.fn();
	selectSegment("list", "list", change);
	selectSegment("list", "board", change);
	expect(log()).toEqual(["selection"]);
	expect(change).toHaveBeenCalledWith("board");
});

test("Radio: selection when picked, nothing when already selected", () => {
	const pick = jest.fn();
	selectRadio(true, pick);
	selectRadio(false, pick);
	expect(log()).toEqual(["selection"]);
});

describe("SwipeRow threshold (40% of a 390 dp row)", () => {
	const run = (xs: number[]) => {
		let armed = false;
		const buzz: number[] = [];
		for (const x of xs) {
			const r = swipeArm(armed, x, 390);
			armed = r.armed;
			if (r.buzz) buzz.push(x);
		}
		return { armed, buzz };
	};
	test("to 30% and back: no haptic", () => {
		expect(run([40, 117, 60, 0])).toEqual({ armed: false, buzz: [] });
	});
	test("past 40%: one light, armed for the release (which plays nothing more)", () => {
		expect(run([100, 156, 200, 250])).toEqual({ armed: true, buzz: [156] });
	});
	test("back under and out again: light again", () => {
		expect(run([160, 100, 170]).buzz).toEqual([160, 170]);
	});
	test("toward the start (negative) arms the same", () => {
		expect(run([-160]).buzz).toEqual([-160]);
	});
});

test("ReorderList: dragging down two slots passes two slots (one selection each) and shifts both neighbours up", () => {
	const slots = { a: 0, b: 1, c: 2, d: 3 };
	const one = reorderSlots(slots, "a", 64 * 1 + 10, 64, 4);
	expect(one).toEqual({ next: { a: 1, b: 0, c: 2, d: 3 }, passed: 1 });
	const two = reorderSlots(one.next, "a", 64 * 2 - 20, 64, 4);
	expect(two).toEqual({ next: { a: 2, b: 0, c: 1, d: 3 }, passed: 1 });
	// A fast drag across both at once still counts both slots.
	expect(reorderSlots(slots, "a", 128, 64, 4)).toEqual({ next: { a: 2, b: 0, c: 1, d: 3 }, passed: 2 });
	// Under a neighbour's midpoint nothing moves.
	expect(reorderSlots(slots, "a", 31, 64, 4).passed).toBe(0);
	// Clamped to the list.
	expect(reorderSlots(slots, "d", 900, 64, 4).passed).toBe(0);
});

describe("SnapCarousel release (316 dp pitch, 6 columns)", () => {
	test("snaps to the nearest item below 500 dp/s", () => {
		expect(snapTarget(316 * 0.4, 499, 316, 6)).toBe(0);
		expect(snapTarget(316 * 0.6, 0, 316, 6)).toBe(1);
	});
	test("a fling past 500 dp/s goes to the next item in its direction", () => {
		expect(snapTarget(316 * 0.2, 501, 316, 6)).toBe(1);
		expect(snapTarget(316 * 1.8, -501, 316, 6)).toBe(1);
	});
	test("clamped to the first and last item", () => {
		expect(snapTarget(-80, -900, 316, 6)).toBe(0);
		expect(snapTarget(316 * 5 + 60, 900, 316, 6)).toBe(5);
	});
});

test("BoardDrag pages only from the outer 48 dp, mirrored in RTL", () => {
	expect([edgeZone(20, 390), edgeZone(200, 390), edgeZone(370, 390)]).toEqual([-1, 0, 1]);
	expect(edgeZone(20, 390, true)).toBe(1);
});

test("ExpandingStrip opens past half way or on a downward fling", () => {
	expect(stripShouldOpen(90, 64, 304, 0)).toBe(false);
	expect(stripShouldOpen(190, 64, 304, 0)).toBe(true);
	expect(stripShouldOpen(70, 64, 304, 600)).toBe(true);
	expect(stripShouldOpen(290, 64, 304, -600)).toBe(false);
});
