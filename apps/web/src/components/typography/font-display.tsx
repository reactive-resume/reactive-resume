import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { resolveFontSource } from "@reactive-resume/fonts/sources";
import { cn } from "@reactive-resume/utils/style";
import { getFontMirrorUrl } from "@/libs/font-source";

interface FontDisplayProps {
	family: string;
	label: string;
	type: "standard" | "web";
	url?: string | undefined;
	highlight?: string;
}

const loadedFonts = new Set<string>();
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 20_000;

/** A mirror is an operator's static host: bound how long and how much one preview may take. */
async function readPreview(source: string, signal: AbortSignal): Promise<ArrayBuffer> {
	const response = await fetch(source, {
		signal: AbortSignal.any([signal, AbortSignal.timeout(PREVIEW_TIMEOUT_MS)]),
		redirect: "error",
	});
	const reader = response.ok ? response.body?.getReader() : undefined;
	if (!reader) throw new Error("Font preview unavailable");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_PREVIEW_BYTES) throw new Error("Font preview too large");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	return new Blob(chunks as BlobPart[]).arrayBuffer();
}

export function FontDisplay({ family, label, type, url, highlight }: FontDisplayProps) {
	const match = highlight?.trim() ? label.toLocaleLowerCase().indexOf(highlight.trim().toLocaleLowerCase()) : -1;
	const fontMirrorUrl = getFontMirrorUrl();
	const source = url ? resolveFontSource(url, fontMirrorUrl) : undefined;
	const previewName = type === "standard" ? family : `rr-preview-${encodeURIComponent(`${family}:${source ?? ""}`)}`;

	const containerRef = useRef<HTMLDivElement>(null);
	const [loadedKey, setLoadedKey] = useState(() => (loadedFonts.has(previewName) ? previewName : undefined));
	const [failedKey, setFailedKey] = useState<string>();
	const isLoaded = type === "standard" || loadedKey === previewName;
	// A failed preview shows its label in the system font at full strength, not as if still loading.
	const isSettled = isLoaded || failedKey === previewName;
	const isInView = useInView(containerRef, { once: true, amount: 0.1, margin: "50px" });

	useEffect(() => {
		if (!isInView || isSettled || !source) return;
		const controller = new AbortController();
		const load = async () => {
			// Loading bytes explicitly lets mirror mode refuse redirects to a third-party font host.
			const bytes = fontMirrorUrl ? await readPreview(source, controller.signal) : `url(${source})`;
			const face = await new FontFace(previewName, bytes, { display: "swap" }).load();
			if (controller.signal.aborted) return;
			document.fonts.add(face);
			loadedFonts.add(previewName);
			setLoadedKey(previewName);
		};
		// An unavailable preview keeps its readable system-font label. Exports report missing fonts separately.
		void load().catch(() => {
			if (!controller.signal.aborted) setFailedKey(previewName);
		});
		return () => controller.abort();
	}, [isInView, isSettled, previewName, source, fontMirrorUrl]);

	return (
		<div ref={containerRef} className="inline-flex items-baseline gap-2">
			<span
				style={{ fontFamily: isLoaded ? `${JSON.stringify(previewName)}, sans-serif` : "sans-serif" }}
				className={cn(isSettled ? "opacity-100" : "opacity-50", "transition-opacity duration-quick ease-enter")}
			>
				{match >= 0 && highlight ? (
					<>
						{label.slice(0, match)}
						<b className="font-semibold">{label.slice(match, match + highlight.trim().length)}</b>
						{label.slice(match + highlight.trim().length)}
					</>
				) : (
					label
				)}
			</span>
			{label !== family && <span className="text-xs text-ink-3">{family}</span>}
		</div>
	);
}
