import type { PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { formatFileSize } from "@reactive-resume/utils/file";
import { privateUploadUrl, readResponseBytes } from "@reactive-resume/utils/http";
import { getAccountGeneration, subscribeAccountChange } from "@/libs/auth/account-scope";

type AttachmentPreviewProps = { source: File | string; name: string };
type PreviewState = { source: File | string; size: number | null; ready: boolean; failed: boolean };

/** Rasterize only page one; private PDFs never become frames or persistent browser-cache entries. */
export function AttachmentPreview({ source, name }: AttachmentPreviewProps) {
	const { t, i18n } = useLingui();
	const root = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<PreviewState | null>(null);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		const target = root.current;
		if (!target) return;
		const generation = getAccountGeneration();
		const abort = new AbortController();
		let active = true;
		let task: PDFDocumentLoadingTask | undefined;
		let render: RenderTask | undefined;
		let size = source instanceof File ? source.size : null;
		const current = () => active && generation === getAccountGeneration();
		const clear = () => {
			active = false;
			abort.abort();
			render?.cancel();
			void task?.destroy().catch(() => {});
			target.replaceChildren();
		};
		const unsubscribe = subscribeAccountChange(() => {
			clear();
			setState(null);
		});
		setState({ source, size, ready: false, failed: false });
		void (async () => {
			let bytes: Uint8Array;
			if (source instanceof File) {
				if (source.size > 10 * 1024 * 1024) throw new Error("PDF too large.");
				bytes = new Uint8Array(await source.arrayBuffer());
			} else {
				const response = await fetch(privateUploadUrl(source, window.location.origin), {
					credentials: "same-origin",
					cache: "no-store",
					redirect: "error",
					signal: abort.signal,
				});
				if (!response.ok || response.redirected) {
					await response.body?.cancel();
					throw new Error("PDF unavailable.");
				}
				bytes = await readResponseBytes(response, 10 * 1024 * 1024, abort.signal);
			}
			if (!current()) return;
			size = bytes.byteLength;
			setState({ source, size, ready: false, failed: false });
			const { getDocument, getPdfWorker } = await import("@/features/resume/preview/pdfjs");
			if (!current()) return;
			task = getDocument({ data: bytes, worker: getPdfWorker() });
			const pdf = await task.promise;
			if (!current()) return;
			const page = await pdf.getPage(1);
			if (!current()) return;
			const original = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: Math.min(2, 320 / original.width, 400 / original.height) });
			const canvas = window.document.createElement("canvas");
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas unavailable.");
			render = page.render({ canvas, canvasContext: context, viewport });
			await render.promise;
			if (!current()) return;
			canvas.className = "max-h-40 max-w-full rounded border border-line";
			target.replaceChildren(canvas);
			setState({ source, size, ready: true, failed: false });
		})()
			.catch(() => {
				if (current()) setState({ source, size, ready: false, failed: true });
			})
			.finally(() => {
				void task?.destroy().catch(() => {});
				task = undefined;
			});
		return () => {
			unsubscribe();
			clear();
		};
	}, [source, attempt]);
	const shown = state?.source === source ? state : null;
	return (
		<div className="grid gap-1.5">
			<div ref={root} role="img" aria-label={`${t`Page 1`} · ${name}`} hidden={!shown?.ready} />
			{shown?.size !== null && shown?.size !== undefined && (
				<span
					className="text-xs text-ink-3"
					title={new Intl.NumberFormat(i18n.locale, { style: "unit", unit: "byte" }).format(shown.size)}
				>
					{formatFileSize(shown.size, i18n.locale)}
				</span>
			)}
			{shown?.failed ? (
				<button
					type="button"
					className="text-start text-xs text-ink-3 underline"
					onClick={() => setAttempt((value) => value + 1)}
				>{t`Couldn't read that file. Try again.`}</button>
			) : !shown?.ready ? (
				<span role="status" className="text-xs text-ink-3">{t`Loading…`}</span>
			) : null}
		</div>
	);
}
