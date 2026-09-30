import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";

interface FontDisplayProps {
	family: string;
	label: string;
	type: "standard" | "web";
	url?: string | undefined;
}

const loadedFonts = new Set<string>();

export function FontDisplay({ family, label, type, url }: FontDisplayProps) {
	const previewName = type === "standard" ? family : `${family} Preview`;

	const containerRef = useRef<HTMLDivElement>(null);
	const [isLoaded, setIsLoaded] = useState(() => type === "standard" || loadedFonts.has(previewName));
	const isInView = useInView(containerRef, { once: true, amount: 0.1, margin: "50px" });

	useEffect(() => {
		if (!isInView || isLoaded || !url) return;

		const fontFace = new FontFace(previewName, `url(${url})`, { display: "swap" });

		void fontFace.load().then((loadedFace) => {
			if (!document.fonts.has(loadedFace)) document.fonts.add(loadedFace);
			loadedFonts.add(previewName);
			setIsLoaded(true);
		});
	}, [isInView, isLoaded, previewName, url]);

	return (
		<div ref={containerRef} className="inline-flex items-baseline gap-2">
			<span
				style={{ fontFamily: isLoaded ? `'${previewName}', sans-serif` : "sans-serif" }}
				className={cn(isLoaded ? "opacity-100" : "opacity-50", "transition-opacity duration-quick ease-enter")}
			>
				{label}
			</span>
			{label !== family && <span className="text-xs text-ink-3">{family}</span>}
		</div>
	);
}
