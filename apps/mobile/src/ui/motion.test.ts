// MOTION.md §10.2: the motion module's behaviour: sheet dismissal, the haptics switch, toast lifetime, hit slop
// and fade-through.
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Platform } from "react-native";
import {
	clearHapticLog,
	createFadeThrough,
	haptic,
	hapticLog,
	hitSlopFor,
	setHapticsEnabled,
	sheetShouldDismiss,
	toastLifetime,
} from "./motion";

type Timing = { to: unknown; config: { duration: number }; callback?: (finished: boolean) => void };
const timings = () => (globalThis as unknown as { __timings: Timing[] }).__timings;

const setPlatform = (os: "ios" | "android", version: number | string = 17) => {
	jest.replaceProperty(Platform, "OS", os);
	jest.spyOn(Platform, "Version", "get").mockReturnValue(version as never);
};

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllMocks();
	timings().length = 0;
	setHapticsEnabled(true);
	clearHapticLog();
});

describe("timings", () => {
	test("sheets dismiss past 25% of the height or faster than 1000 dp/s", () => {
		expect(sheetShouldDismiss(0.249 * 400, 400, 0)).toBe(false);
		expect(sheetShouldDismiss(0.251 * 400, 400, 0)).toBe(true);
		expect(sheetShouldDismiss(0, 400, 999)).toBe(false);
		expect(sheetShouldDismiss(0, 400, 1001)).toBe(true);
	});
});

describe("haptic()", () => {
	const tokens = [
		"selection",
		"toggleOn",
		"toggleOff",
		"light",
		"medium",
		"rigid",
		"soft",
		"success",
		"warning",
		"error",
	];
	test.each([
		["ios", 17],
		["android", 29],
		["android", 30],
		["android", 33],
		["android", 34],
	] as const)("the in-app switch off on %s %s plays nothing but logs every token", (os, version) => {
		setPlatform(os, version);
		setHapticsEnabled(false);
		for (const token of tokens) haptic(token as never);
		expect(Haptics.selectionAsync).not.toHaveBeenCalled();
		expect(Haptics.impactAsync).not.toHaveBeenCalled();
		expect(Haptics.notificationAsync).not.toHaveBeenCalled();
		expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
		expect(hapticLog().map((e) => [e.token, e.played])).toEqual(tokens.map((token) => [token, false]));
	});
});

describe("toastLifetime()", () => {
	test("5 s plain, 8 s with an action", async () => {
		setPlatform("ios");
		jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
		await expect(toastLifetime(false)).resolves.toBe(5000);
		await expect(toastLifetime(true)).resolves.toBe(8000);
	});

	test("with a screen reader, a toast with an action stays", async () => {
		jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
		await expect(toastLifetime(true)).resolves.toBeNull();
		setPlatform("ios");
		await expect(toastLifetime(false)).resolves.toBe(5000);
	});

	test("Android's accessibility timeout only lengthens it", async () => {
		setPlatform("android", 34);
		jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(false);
		const timeout = jest.spyOn(AccessibilityInfo, "getRecommendedTimeoutMillis");
		timeout.mockResolvedValue(20000);
		await expect(toastLifetime(false)).resolves.toBe(20000);
		timeout.mockResolvedValue(1000);
		await expect(toastLifetime(true)).resolves.toBe(8000);
	});
});

test("hitSlopFor grows a 24 × 24 drawing to 44 pt on iOS and 48 dp on Android, nothing at or above", () => {
	setPlatform("ios");
	expect(hitSlopFor(24, 24)).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
	expect(hitSlopFor(44, 60)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
	setPlatform("android", 34);
	expect(hitSlopFor(24, 24)).toEqual({ top: 12, bottom: 12, left: 12, right: 12 });
	expect(hitSlopFor(48, 48)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
});

test("fade-through: the old content reaches 0 over 140 ms before navigating; the new rises over d2 after", () => {
	const progress = { value: 1 } as never;
	const api = createFadeThrough(progress, false);
	const navigate = jest.fn();
	api.switchTo(navigate);
	expect(timings().at(-1)).toMatchObject({ to: 0, config: { duration: 140 } });
	expect(navigate).not.toHaveBeenCalled();
	// A second tap during the fade retargets.
	const second = jest.fn();
	api.switchTo(second);
	timings().at(-1)?.callback?.(true);
	expect(navigate).not.toHaveBeenCalled();
	expect(second).toHaveBeenCalledTimes(1);
	expect(timings().filter((t) => t.to === 1)).toHaveLength(0); // nothing rose before the navigation
	api.revealFocused();
	expect(timings().at(-1)).toMatchObject({ to: 1, config: { duration: 200 } });
});

test("fade-through under reduced motion navigates at once", () => {
	const api = createFadeThrough({ value: 1 } as never, true);
	const navigate = jest.fn();
	api.switchTo(navigate);
	expect(navigate).toHaveBeenCalledTimes(1);
});

test("fade-through with keyed scenes: the new scene rises the moment the old is gone, then navigation follows", () => {
	const target = { value: null as string | null };
	const api = createFadeThrough({ value: 1 } as never, false, target as never);
	api.keyed.current = true;
	const navigate = jest.fn(() => expect(timings().at(-1)).toMatchObject({ to: 1, config: { duration: 200 } }));
	api.switchTo(navigate, "documents");
	expect(timings().at(-1)).toMatchObject({ to: 0, config: { duration: 140 } });
	timings().at(-1)?.callback?.(true);
	expect(target.value).toBe("documents");
	expect(navigate).toHaveBeenCalledTimes(1);
	// The focused scene's own reveal does not restart the rise.
	const before = timings().length;
	api.revealFocused("documents");
	expect(timings()).toHaveLength(before);
});
