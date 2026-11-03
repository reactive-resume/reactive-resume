import { useCallback, useState } from "react";

const clearances = new Map<HTMLDivElement, number>();
const updateClearance = () => {
	const clearance = Math.max(0, ...clearances.values());
	const style = document.documentElement.style;
	if (clearance) style.setProperty("--floating-toolbar-clearance", `${clearance}px`);
	else style.removeProperty("--floating-toolbar-clearance");
};

/** Room to scroll the last row above a fixed toolbar, including wrapped labels and its bottom inset. */
export function useFloatingToolbarSpace() {
	const [space, setSpace] = useState(0);
	const ref = useCallback((element: HTMLDivElement | null) => {
		if (!element) return;
		const measure = () => {
			const space = element.offsetHeight + (Number.parseFloat(getComputedStyle(element).bottom) || 0) + 16;
			setSpace(space);
			clearances.set(
				element,
				element.offsetHeight && element.getAttribute("aria-hidden") !== "true"
					? Math.max(space, window.innerHeight - element.getBoundingClientRect().top + 16)
					: 0,
			);
			updateClearance();
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		if (element.parentElement) observer.observe(element.parentElement);
		const visibility = new MutationObserver(measure);
		visibility.observe(element, { attributes: true, attributeFilter: ["aria-hidden"] });
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			visibility.disconnect();
			window.removeEventListener("resize", measure);
			clearances.delete(element);
			updateClearance();
		};
	}, []);
	return { ref, space };
}
