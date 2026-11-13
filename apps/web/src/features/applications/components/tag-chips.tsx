import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";

type TagChipsProps = {
	tags: readonly string[];
	/** When set, a chip filters by its tag; without it, chips are labels only (for example inside a drag overlay). */
	onSelect?: ((tag: string) => void) | undefined;
	className?: string;
	fit?: boolean;
};

/** Up to two of an application's tags, as small chips beside its company; the rest are counted. */
export function TagChips({ tags, onSelect, className, fit = false }: TagChipsProps) {
	const container = useRef<HTMLSpanElement>(null);
	const [visible, setVisible] = useState(2);
	useLayoutEffect(() => {
		const element = container.current;
		if (!fit || !element) return;
		const measure = () => {
			let used = 0;
			let count = 0;
			const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
			for (const child of element.querySelectorAll<HTMLElement>("[data-tag]")) {
				used += child.getBoundingClientRect().width + (count ? gap : 0);
				if (used > element.clientWidth) break;
				count++;
			}
			setVisible(count);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		for (const chip of element.querySelectorAll("[data-tag]")) observer.observe(chip);
		return () => observer.disconnect();
	}, [fit, tags]);
	if (tags.length === 0) return null;
	return (
		<span ref={container} className={cn("ms-1.5 inline-flex items-center gap-1 align-middle", className)}>
			{tags.slice(0, 2).map((tag, index) =>
				onSelect ? (
					<button
						key={tag}
						data-tag
						style={fit && index >= visible ? { visibility: "hidden" } : undefined}
						type="button"
						tabIndex={fit && index >= visible ? -1 : undefined}
						dir="auto"
						aria-label={t`Filter by ${tag}`}
						onClick={(event) => {
							// The row (and board card) opens on click; filtering is its own action.
							event.stopPropagation();
							onSelect(tag);
						}}
						className="touch-target relative shrink-0 rounded-sm bg-sunken px-1.5 text-xs leading-4 whitespace-nowrap text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink"
					>
						{tag}
					</button>
				) : (
					<span
						key={tag}
						data-tag
						style={fit && index >= visible ? { visibility: "hidden" } : undefined}
						dir="auto"
						className="shrink-0 rounded-sm bg-sunken px-1.5 text-xs leading-4 whitespace-nowrap text-ink-2"
					>
						{tag}
					</span>
				),
			)}
			{!fit && tags.length > 2 && <span className="text-xs leading-4 text-ink-3">+{i18n.number(tags.length - 2)}</span>}
		</span>
	);
}
