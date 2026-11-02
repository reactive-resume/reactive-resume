import { useCallback, useState } from "react";

/** Room to scroll the last row above a fixed toolbar, including wrapped labels and its bottom inset. */
export function useFloatingToolbarSpace() {
	const [space, setSpace] = useState(0);
	const ref = useCallback((element: HTMLDivElement | null) => {
		if (!element) return;
		const measure = () =>
			setSpace(element.offsetHeight + (Number.parseFloat(getComputedStyle(element).bottom) || 0) + 16);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return { ref, space };
}
