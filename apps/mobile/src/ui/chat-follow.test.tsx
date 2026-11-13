import { act, fireEvent, render } from "@testing-library/react-native";
import { ScrollView, Text, View } from "react-native";
import { setUpTests } from "react-native-reanimated";
import { follow, initialFollow, settleRoom } from "./chat-follow";
import { useChatFollow } from "./ChatFollow";

// B16 and C2 (MOTION.md §8): follow a streaming reply only at the bottom, "Latest" after scrolling away, and C2's
// question settles near the top. The device can't be driven here; the hook is, through its scroll view's events.
jest.unmock("react-native-reanimated");
jest.mock("@/dev/storyboard/harness", () => ({ useDesignTag: () => null }));
setUpTests();

const at = (offset: number) => ({ offset, viewport: 600, content: 2000 });
const end = 1400;

test("the reader leaving the end stops following and shows Latest; coming back resumes it", () => {
	let state = follow(initialFollow, { type: "send" }).state;
	expect(state).toEqual({ following: true, latest: false });
	state = follow(state, { type: "drag" }).state;
	expect(follow(state, { type: "grow" }).scroll).toBe("none");
	// Let go mid-fling: no Latest yet, the momentum end decides.
	state = follow(state, { type: "rest", metrics: at(900), moving: true }).state;
	expect(state).toEqual({ following: false, latest: false });
	state = follow(state, { type: "rest", metrics: at(700) }).state;
	expect(state).toEqual({ following: false, latest: true });
	// Within 24 dp of the end counts as the end.
	state = follow(state, { type: "rest", metrics: at(end - 24) }).state;
	expect(state).toEqual({ following: true, latest: false });
	expect(follow(state, { type: "grow" }).scroll).toBe("end");
});

test("content growing under a reader who never scrolled shows no Latest", () => {
	expect(follow(initialFollow, { type: "grow" })).toEqual({ state: initialFollow, scroll: "none" });
});

test("the room under a new question lands it 16 dp from the top, shrinking as the reply fills it", () => {
	// Question at y 1000 in 1100 dp of content, a 600 dp view: the end must be at 984 + 600.
	expect(settleRoom(1000, 1100, 600)).toBe(484);
	expect(settleRoom(1000, 1400, 600)).toBe(184);
	expect(settleRoom(1000, 1800, 600)).toBe(0);
});

function Conversation({ question, settle }: { question?: string; settle?: boolean }) {
	const chat = useChatFollow({ question, settle });
	return (
		<View>
			<ScrollView
				testID="list"
				ref={(node) => chat.attach(node ? { scrollToEnd } : null)}
				{...chat.scrollProps}
				contentContainerStyle={{ paddingBottom: chat.room }}
			>
				<Text onLayout={chat.anchor}>Question</Text>
			</ScrollView>
			{chat.latest}
		</View>
	);
}
const scrollToEnd = jest.fn();
const scrollEvent = (offset: number, velocity = 0) => ({
	nativeEvent: {
		contentOffset: { x: 0, y: offset },
		layoutMeasurement: { width: 390, height: 600 },
		contentSize: { width: 390, height: 2000 },
		velocity: { x: 0, y: velocity },
	},
});

beforeEach(() => {
	jest.useFakeTimers();
	scrollToEnd.mockClear();
});
afterEach(() => jest.useRealTimers());

test("a conversation at rest has no Latest; scrolling away shows it and tapping it goes to the end", async () => {
	const screen = await render(<Conversation />);
	const list = screen.getByTestId("list");
	await fireEvent(list, "contentSizeChange", 390, 2000);
	expect(screen.queryByTestId("chat-latest")).toBeNull();
	expect(scrollToEnd).not.toHaveBeenCalled();
	await screen.rerender(<Conversation question="1" />);
	expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });
	await fireEvent(list, "scrollBeginDrag", scrollEvent(end));
	await fireEvent(list, "scrollEndDrag", scrollEvent(800));
	// Streamed text while away doesn't move the list.
	scrollToEnd.mockClear();
	await fireEvent(list, "contentSizeChange", 390, 2100);
	expect(scrollToEnd).not.toHaveBeenCalled();
	const latest = screen.getByRole("button", { name: "Latest" });
	expect(latest.props.accessibilityHint).toBe("Scrolls to the newest message");
	await fireEvent.press(latest);
	expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: true });
	// It fades out, then is gone; following resumes.
	await act(async () => jest.advanceTimersByTime(500));
	expect(screen.queryByTestId("chat-latest")).toBeNull();
	await fireEvent(list, "contentSizeChange", 390, 2200);
	expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });
});

test("C2: a new question gets the room to settle near the top", async () => {
	const screen = await render(<Conversation settle />);
	const list = screen.getByTestId("list");
	await fireEvent(list, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } } });
	await fireEvent(list, "contentSizeChange", 390, 1100);
	await screen.rerender(<Conversation settle question="q2" />);
	await fireEvent(screen.getByText("Question"), "layout", {
		nativeEvent: { layout: { x: 24, y: 1000, width: 342, height: 24 } },
	});
	expect(list.props.contentContainerStyle).toEqual({ paddingBottom: 484 });
	expect(scrollToEnd).toHaveBeenLastCalledWith({ animated: false });
});
