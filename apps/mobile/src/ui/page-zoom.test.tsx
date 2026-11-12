import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { GestureHandlerRootView, State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { setUpTests } from "react-native-reanimated";
import { clearHapticLog, hapticLog } from "./motion";
import { PageZoom } from "./PageZoom";

// B18: Maestro's double tap doesn't reach the gesture handler, so the double-tap is driven here through its events.
jest.unmock("react-native-reanimated");
jest.mock("react-native-gesture-handler", () => {
	// RNGH's own Jest mocks: handlers register with the test registry so their events can be fired.
	jest.requireActual("react-native-gesture-handler/jestSetup");
	return jest.requireActual("react-native-gesture-handler");
});
setUpTests();
const log = () => hapticLog().map((e) => e.token);

test("double-tap toggles fit and 200 %, playing selection each time it snaps", async () => {
	jest.useFakeTimers();
	clearHapticLog();
	const zooms: number[] = [];
	await render(
		<GestureHandlerRootView>
			<PageZoom onZoom={(s) => zooms.push(s)}>
				<Text>Page</Text>
			</PageZoom>
		</GestureHandlerRootView>,
	);
	const tap = getByGestureTestId("page-zoom-double-tap");
	const doubleTap = () =>
		act(() =>
			fireGestureHandler(tap, [
				{ state: State.BEGAN },
				{ state: State.ACTIVE, x: 100, y: 120 },
				{ state: State.END, x: 100, y: 120 },
			]),
		);
	await doubleTap();
	await act(async () => jest.advanceTimersByTime(500));
	expect(zooms).toEqual([2]);
	await doubleTap();
	await act(async () => jest.advanceTimersByTime(500));
	expect(zooms).toEqual([2, 1]);
	expect(log()).toEqual(["selection", "selection"]);
	jest.useRealTimers();
});
