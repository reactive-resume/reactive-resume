import { act, fireEvent, render } from "@testing-library/react-native";
import { createRef } from "react";
import { View } from "react-native";
import { setUpTests } from "react-native-reanimated";
import { makeMutable } from "react-native-reanimated";
import { Checkbox } from "./Checkbox";
import { clearHapticLog, createFadeThrough, hapticLog } from "./motion";
import { Radio } from "./Radio";
import { ReorderList, type ReorderHandle } from "./ReorderList";
import { Segmented } from "./Segmented";
import { SnapCarousel, type SnapCarouselHandle } from "./SnapCarousel";
import { Switch } from "./Switch";
import { dismissToast, pauseToast, resumeToast, showToast, ToastHost } from "./Toast";

// Use the resolver-backed implementation: reactions and completion callbacks must actually run.
jest.unmock("react-native-reanimated");
jest.mock("@/dev/storyboard/harness", () => ({ useDesignTag: () => null }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
setUpTests();
const log = () => hapticLog().map((e) => e.token);
const advance = async (ms: number) => {
	await act(async () => {
		jest.advanceTimersByTime(ms);
	});
};
beforeEach(() => {
	jest.useFakeTimers();
	clearHapticLog();
});
afterEach(async () => {
	await act(async () => dismissToast());
	jest.useRealTimers();
});

test.each([false, true])("Switch value %s: accessibility activation saves once with one toggle", async (value) => {
	const change = jest.fn();
	const screen = await render(<Switch value={value} onValueChange={change} accessibilityLabel="Publish" />);
	expect(log()).toEqual([]);
	await fireEvent(screen.getByLabelText("Publish"), "accessibilityTap");
	expect(change.mock.calls).toEqual([[!value]]);
	expect(log()).toEqual([value ? "toggleOff" : "toggleOn"]);
});

test.each([false, true])("Checkbox value %s: one saved toggle", async (value) => {
	const change = jest.fn();
	const screen = await render(<Checkbox value={value} onValueChange={change} accessibilityLabel="Remember" />);
	expect(log()).toEqual([]);
	await fireEvent(screen.getByLabelText("Remember"), "accessibilityTap");
	expect(change.mock.calls).toEqual([[!value]]);
	expect(log()).toEqual([value ? "toggleOff" : "toggleOn"]);
});

test("staged Checkbox changes without a haptic", async () => {
	const change = jest.fn();
	const screen = await render(
		<Checkbox value={false} saves={false} onValueChange={change} accessibilityLabel="Stage" />,
	);
	await fireEvent(screen.getByLabelText("Stage"), "accessibilityTap");
	expect(change).toHaveBeenCalledWith(true);
	expect(log()).toEqual([]);
});

test("Segmented: choosing another view emits one selection", async () => {
	const change = jest.fn();
	const screen = await render(
		<Segmented
			value="list"
			options={[
				{ key: "list", label: "List" },
				{ key: "board", label: "Board" },
			]}
			onChange={change}
		/>,
	);
	expect(log()).toEqual([]);
	await fireEvent(screen.getByLabelText("Board"), "accessibilityTap");
	expect(change.mock.calls).toEqual([["board"]]);
	expect(log()).toEqual(["selection"]);
});

test("Radio: picking an unselected value emits one selection", async () => {
	const pick = jest.fn();
	const screen = await render(<Radio selected={false} onSelect={pick} accessibilityLabel="Applied" />);
	expect(log()).toEqual([]);
	await fireEvent(screen.getByLabelText("Applied"), "accessibilityTap");
	expect(pick).toHaveBeenCalledTimes(1);
	expect(log()).toEqual(["selection"]);
});

const items = ["a", "b", "c"];
test("ReorderList: lift, two slots, land emits medium selection selection rigid", async () => {
	const ref = createRef<ReorderHandle>();
	const changed = jest.fn();
	await render(
		<ReorderList
			ref={ref}
			data={items}
			keyOf={(s) => s}
			itemHeight={64}
			renderItem={() => <View />}
			onReorder={changed}
		/>,
	);
	expect(log()).toEqual([]);
	await act(() => ref.current?.lift("a"));
	await advance(140);
	await act(() => ref.current?.dragBy("a", 128));
	await advance(220);
	await act(() => ref.current?.drop("a"));
	await advance(400);
	expect(changed.mock.calls).toEqual([[0, 2]]);
	expect(log()).toEqual(["medium", "selection", "selection", "rigid"]);
});

test.each([
	["moveUp", 0],
	["moveDown", 2],
] as const)("ReorderList accessibility %s moves one slot with one selection", async (action, target) => {
	const changed = jest.fn();
	const screen = await render(
		<ReorderList
			data={items}
			keyOf={(s) => s}
			label={(s) => s}
			itemHeight={64}
			renderItem={() => <View />}
			onReorder={changed}
		/>,
	);
	await fireEvent(screen.getByLabelText("b"), "accessibilityAction", { nativeEvent: { actionName: action } });
	await advance(400);
	expect(changed.mock.calls).toEqual([[1, target]]);
	expect(log()).toEqual(["selection"]);
});

test("SnapCarousel: pan is silent; release to a new page emits one selection", async () => {
	const ref = createRef<SnapCarouselHandle>();
	const changed = jest.fn();
	await render(
		<SnapCarousel
			ref={ref}
			data={items}
			keyOf={(s) => s}
			itemWidth={100}
			renderItem={() => <View />}
			onIndexChange={changed}
		/>,
	);
	expect(log()).toEqual([]);
	await act(() => ref.current?.panBy(-75));
	expect(log()).toEqual([]);
	await act(() => ref.current?.release(0));
	await advance(400);
	expect(changed.mock.calls).toEqual([[1]]);
	expect(log()).toEqual(["selection"]);
});

test.each([false, true])(
	"fade-through keyed=%s reaches zero after 140 ms before navigating, then rises",
	async (keyed) => {
		const progress = makeMutable(1);
		const api = createFadeThrough(progress, false);
		api.keyed.current = keyed;
		const navigate = jest.fn(() => expect(progress.value).toBe(0));
		api.switchTo(navigate, "documents");
		await advance(139);
		expect(navigate).not.toHaveBeenCalled();
		expect(progress.value).toBeGreaterThan(0);
		// Completion is delivered on the next animation frame (60 Hz).
		await advance(28);
		expect(navigate).toHaveBeenCalledTimes(1);
		if (keyed) expect(progress.value).toBeGreaterThan(0);
		else expect(progress.value).toBe(0);
		const beforeReveal = progress.value;
		api.revealFocused("documents");
		expect(progress.value).toBe(beforeReveal);
		await advance(100);
		expect(progress.value).toBeGreaterThan(0);
		expect(progress.value).toBeLessThan(1);
		await advance(150);
		expect(progress.value).toBe(1);
	},
);

test.each(["API", "touch"])("Toast %s pause and resume preserve remaining lifetime", async (input) => {
	const screen = await render(<ToastHost />);
	await act(async () => {
		showToast({ message: "Saved" });
	});
	await advance(2000);
	if (input === "API") await act(() => pauseToast());
	else await fireEvent(screen.getByText("Saved"), "touchStart");
	await advance(6000);
	expect(screen.getByText("Saved")).toBeTruthy();
	if (input === "API") await act(() => resumeToast());
	else await fireEvent(screen.getByText("Saved"), "touchEnd");
	await advance(2500);
	expect(screen.getByText("Saved")).toBeTruthy();
	await advance(1000);
	expect(screen.queryByText("Saved")).toBeNull();
});
