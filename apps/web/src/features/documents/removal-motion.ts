import type { OnDocumentEffect } from "./library-session";
import type { RefObject } from "react";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { DocumentLibraryContext } from "./library-session";
import { D1, D2, EASE, EXIT } from "@/libs/motion";

type RemovalMotionOptions = {
	container: RefObject<HTMLElement | null>;
	scope: string;
	trashed: boolean;
	data: unknown;
	fetching: boolean;
	failed: boolean;
};

/** Fade confirmed removals before refreshing; unmounting/filtering itself never starts an exit. */
export function useDocumentRemovalMotion({ container, scope, trashed, data, fetching, failed }: RemovalMotionOptions) {
	const session = useContext(DocumentLibraryContext);
	const currentScope = useRef<string | null>(scope);
	const active = useRef(new Map<Animation, { element: HTMLElement; inert: boolean }>());
	const reset = useCallback(() => {
		for (const [animation, previous] of active.current) {
			animation.cancel();
			previous.element.inert = previous.inert;
		}
		active.current.clear();
	}, []);
	useLayoutEffect(() => {
		currentScope.current = scope;
		return () => {
			currentScope.current = null;
			reset();
		};
	}, [scope, reset]);
	useEffect(() => {
		if (!fetching && !failed) reset();
	}, [data, fetching, failed, reset]);
	useEffect(() => {
		const onVisibility = () => {
			if (document.hidden) reset();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, [reset]);

	const onEffect = useCallback<OnDocumentEffect>(
		async (effect, documents) => {
			if (currentScope.current !== scope) return;
			const removes = trashed ? effect !== "trash" : effect === "trash";
			if (!removes) return;
			if (document.hidden || !container.current) return;
			const ids = documents && new Set(documents.map((item) => `${item.type}:${item.id}`));
			const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			const elements = [...container.current.querySelectorAll<HTMLElement>("[data-document-key]")].filter(
				(element) => !ids || ids.has(element.dataset.documentKey ?? ""),
			);
			await Promise.all(
				elements.map(async (element) => {
					const animation = element.animate(
						{ opacity: [Number(getComputedStyle(element).opacity), 0], ...(reduced ? {} : { scale: [1, 0.98] }) },
						{
							duration: (reduced ? D1 : D2 * EXIT) * 1000,
							easing: `cubic-bezier(${EASE.join(",")})`,
							fill: "forwards",
						},
					);
					active.current.set(animation, { element, inert: element.inert });
					element.inert = true;
					// Keep it faded until the refreshed data arrives; cancellation releases background/navigation waits.
					await animation.finished.catch(() => undefined);
				}),
			).catch(reset);
		},
		[container, scope, trashed, reset],
	);
	const registerEffect = session?.registerEffect;
	useLayoutEffect(() => registerEffect?.(onEffect), [registerEffect, onEffect]);
}
