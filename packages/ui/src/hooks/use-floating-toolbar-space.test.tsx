import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { useFloatingToolbarSpace } from "./use-floating-toolbar-space";

it("retains the newer toolbar's clearance when an outgoing owner unmounts, then releases it when hidden", async () => {
	const first = renderHook(useFloatingToolbarSpace);
	const second = renderHook(useFloatingToolbarSpace);
	const bars = [80, 120].map((height) => {
		const element = document.createElement("div");
		element.style.bottom = "69px";
		Object.defineProperty(element, "offsetHeight", { value: height });
		element.getBoundingClientRect = () => new DOMRect(0, window.innerHeight - height - 69, 200, height);
		document.body.append(element);
		return element;
	});
	const [firstBar, secondBar] = bars;
	if (!firstBar || !secondBar) throw new Error("Both toolbar owners are required.");
	const clearance = () => document.documentElement.style.getPropertyValue("--floating-toolbar-clearance");
	let detachFirst: (() => void) | undefined;
	let detachSecond: (() => void) | undefined;
	try {
		act(() => {
			detachFirst = first.result.current.ref(firstBar);
			detachSecond = second.result.current.ref(secondBar);
		});
		expect(clearance()).toBe("205px");
		act(() => detachFirst?.());
		expect(clearance()).toBe("205px");
		secondBar.setAttribute("aria-hidden", "true");
		await waitFor(() => expect(clearance()).toBe(""));
		secondBar.setAttribute("aria-hidden", "false");
		await waitFor(() => expect(clearance()).toBe("205px"));
	} finally {
		act(() => {
			detachFirst?.();
			detachSecond?.();
		});
		first.unmount();
		second.unmount();
		for (const element of bars) element.remove();
	}
	expect(clearance()).toBe("");
});
