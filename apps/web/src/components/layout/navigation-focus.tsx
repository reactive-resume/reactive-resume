import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

/** Path changes move keyboard/AT focus; filter, editor-mode and dialog search changes keep it in place. */
export function NavigationFocus() {
	const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });
	useEffect(() => {
		if (!pathname) return;
		const frame = requestAnimationFrame(() => {
			if (
				document.querySelector(
					'[role="dialog"]:not([data-closed]):not([data-slot="toast"]), [role="alertdialog"]:not([data-closed]):not([data-slot="toast"]), dialog[open]',
				)
			)
				return;
			const target =
				document.querySelector<HTMLElement>("[data-route-focus] input") ??
				document.querySelector<HTMLElement>("main h1, h1") ??
				document.querySelector<HTMLElement>("main, #main-content");
			if (!target) return;
			if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1;
			target.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [pathname]);
	return null;
}
