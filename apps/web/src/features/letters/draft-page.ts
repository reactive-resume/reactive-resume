import { useEffect, useRef, useState } from "react";

// A streaming draft re-renders the page a few times a second, not per word.
export const DRAFT_THROTTLE_MS = 400;

/**
 * `value` at most every `ms`: the first change at once, the latest one when the wait ends. Timers only, never the
 * clock: a debounce that compares `Date.now()` stops at its first value when the clock doesn't move (a frozen test
 * clock), which left a streaming draft on the page as its first word.
 */
export function useThrottledValue<T>(value: T, ms: number): T {
	const [shown, setShown] = useState(value);
	const latest = useRef(value);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		latest.current = value;
		if (timer.current !== null || Object.is(value, shown)) return;
		// The leading edge; changes during the wait follow when it ends.
		// oxlint-disable-next-line react/set-state-in-effect -- a throttle is state that follows the value on a timer.
		setShown(value);
		timer.current = setTimeout(() => {
			timer.current = null;
			setShown(latest.current);
		}, ms);
	}, [value, shown, ms]);
	useEffect(
		() => () => {
			if (timer.current !== null) clearTimeout(timer.current);
		},
		[],
	);
	return shown;
}
