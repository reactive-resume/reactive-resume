// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { useThrottledValue } from "./draft-page";

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("shows the latest streamed text even when the clock doesn't move", () => {
	// The capture freezes Date.now(); a clock-based debounce stopped at the first word ("I").
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-07T09:00:00Z"));
	const { result, rerender } = renderHook(({ value }) => useThrottledValue(value, 400), {
		initialProps: { value: null as string | null },
	});

	rerender({ value: "I" });
	expect(result.current).toBe("I");
	rerender({ value: "I am" });
	rerender({ value: "I am applying" });
	expect(result.current).toBe("I");
	act(() => void vi.advanceTimersByTime(400));
	expect(result.current).toBe("I am applying");
});
