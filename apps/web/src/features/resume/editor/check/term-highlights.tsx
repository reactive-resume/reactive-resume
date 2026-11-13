import type { PDFDocumentProxy, TextLayer as PdfTextLayer } from "pdfjs-dist";
import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

/** Marks text-layer ranges, including phrases split across font runs or lines, without changing the PDF. */
function markTerm(divs: readonly HTMLElement[], strings: readonly string[], forms: readonly string[]) {
	const text = strings
		.map((value, index) => value + (divs[index]?.nextElementSibling?.tagName === "BR" ? "\n" : ""))
		.join("");
	// shortcut: surface aliases plus regular plurals; expose matcher ranges before highlighting other inflections.
	const surfaces = [
		...new Set(
			forms.flatMap((form) =>
				/[a-z]{3}$/i.test(form) ? [form, /[^s]s$/i.test(form) ? form.slice(0, -1) : form + "s"] : [form],
			),
		),
	];
	const escaped = surfaces
		.filter(Boolean)
		.map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
	if (!escaped.length) return;
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}_])(?:${escaped.sort((a, b) => b.length - a.length).join("|")})(?![\\p{L}\\p{N}_])`,
		"giu",
	);
	const matches = [...text.matchAll(pattern)];
	let offset = 0;
	divs.forEach((div, index) => {
		const value = strings[index] ?? "";
		const fragment = document.createDocumentFragment();
		let cursor = 0;
		for (const match of matches) {
			const start = Math.max(0, match.index - offset);
			const end = Math.min(value.length, match.index + match[0].length - offset);
			if (end <= start) continue;
			fragment.append(value.slice(cursor, start));
			const mark = document.createElement("mark");
			mark.textContent = value.slice(start, end);
			fragment.append(mark);
			cursor = end;
		}
		fragment.append(value.slice(cursor));
		const newline = div.nextElementSibling?.tagName === "BR";
		div.replaceChildren(fragment);
		offset += value.length + (newline ? 1 : 0);
	});
}

type TermHighlightsProps = { document: PDFDocumentProxy; pageIndex: number; scale: number; term: string };

export function TermHighlights({ document, pageIndex, scale, term }: TermHighlightsProps) {
	const container = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = container.current;
		if (!element) return;
		let cancelled = false;
		let layer: PdfTextLayer | undefined;
		void (async () => {
			const [page, { TextLayer }, { surfaceFormsOf }] = await Promise.all([
				document.getPage(pageIndex + 1),
				import("@/features/resume/preview/pdfjs"),
				import("@reactive-resume/resume/ats-pdf"),
			]);
			if (cancelled) return;
			layer = new TextLayer({
				container: element,
				textContentSource: page.streamTextContent(),
				viewport: page.getViewport({ scale }),
			});
			await layer.render();
			if (!cancelled) markTerm(layer.textDivs, layer.textContentItemsStr, surfaceFormsOf(term));
		})().catch(() => {
			if (!cancelled) element.replaceChildren();
		});
		return () => {
			cancelled = true;
			layer?.cancel();
			element.replaceChildren();
		};
	}, [document, pageIndex, scale, term]);
	return (
		<div
			ref={container}
			aria-hidden="true"
			data-term-highlights
			className="term-highlights"
			style={{ "--total-scale-factor": scale } as CSSProperties}
		/>
	);
}
