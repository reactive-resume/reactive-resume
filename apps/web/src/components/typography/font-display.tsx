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
}

const loadedFonts = new Set<string>();

export function FontDisplay({ family, label, type, url }: FontDisplayProps) {
	const fontMirrorUrl = getFontMirrorUrl();
	const source = url ? resolveFontSource(url, fontMirrorUrl) : undefined;
	const previewName = type === "standard" ? family : `rr-preview-${encodeURIComponent(`${family}:${source ?? ""}`)}`;
	const key = previewName;

	const containerRef = useRef<HTMLDivElement>(null);
	const [loadedKey, setLoadedKey] = useState(() => (loadedFonts.has(key) ? key : undefined));
	const isLoaded = type === "standard" || loadedKey === key;
	const isInView = useInView(containerRef, { once: true, amount: 0.1, margin: "50px" });

	useEffect(() => {
		if (!isInView || isLoaded || !source) return;
		const controller = new AbortController();
		const load = async () => {
			// Loading bytes explicitly lets mirror mode refuse redirects to a third-party font host.
			let bytes: ArrayBuffer | string = `url(${source})`;
			if (fontMirrorUrl) {
				const response = await fetch(source, { signal: controller.signal, redirect: "error" });
				if (!response.ok) throw new Error("Font preview unavailable");
				bytes = await response.arrayBuffer();
			}
			const face = await new FontFace(previewName, bytes, { display: "swap" }).load();
			if (controller.signal.aborted) return;
			document.fonts.add(face);
			loadedFonts.add(key);
			setLoadedKey(key);
		};
		// An unavailable preview keeps its readable system-font label. Exports report missing fonts separately.
		void load().catch(() => undefined);
		return () => controller.abort();
	}, [isInView, isLoaded, previewName, source, fontMirrorUrl, key]);

	return (
		<div ref={containerRef} className="inline-flex items-baseline gap-2">
			<span
				style={{ fontFamily: isLoaded ? `${JSON.stringify(previewName)}, sans-serif` : "sans-serif" }}
				className={cn(isLoaded ? "opacity-100" : "opacity-50", "transition-opacity duration-quick ease-enter")}
			>
				{label}
			</span>
			{label !== family && <span className="text-xs text-ink-3">{family}</span>}
		</div>
	);
}
