import { useCallback, useRef, useState } from "react";

export type PageRect = { left: number; top: number; width: number; height: number };

// Measures each rendered `.page` element (from the PDF.js-backed PdfViewer) relative to a
// wrapper container, so a caller can overlay absolutely-positioned content (e.g. comment pins)
// at normalized (0..1) coordinates that stay correct across zoom/resize. Pass `recomputeRects`
// as PdfViewer's `onLayout` prop and `wrapperRef` on the element wrapping it.
export function usePdfPageRects() {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const [pageRects, setPageRects] = useState<Map<number, PageRect>>(new Map());

	const recomputeRects = useCallback(() => {
		const wrapper = wrapperRef.current;
		if (!wrapper) return;

		const wrapperRect = wrapper.getBoundingClientRect();
		const next = new Map<number, PageRect>();

		for (const [index, pageElement] of [...wrapper.querySelectorAll<HTMLElement>(".page")].entries()) {
			const pageNumber = Number(pageElement.dataset.pageNumber) || index + 1;
			const rect = pageElement.getBoundingClientRect();
			next.set(pageNumber, {
				left: rect.left - wrapperRect.left,
				top: rect.top - wrapperRect.top,
				width: rect.width,
				height: rect.height,
			});
		}

		setPageRects(next);
	}, []);

	return { wrapperRef, pageRects, recomputeRects };
}
