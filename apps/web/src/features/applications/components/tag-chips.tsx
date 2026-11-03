import { t } from "@lingui/core/macro";
import { cn } from "@reactive-resume/utils/style";

type TagChipsProps = {
	tags: readonly string[];
	/** When set, a chip filters by its tag; without it, chips are labels only (for example inside a drag overlay). */
	onSelect?: ((tag: string) => void) | undefined;
	className?: string;
};

/** Up to two of an application's tags, as small chips beside its company; the rest are counted. */
export function TagChips({ tags, onSelect, className }: TagChipsProps) {
	if (tags.length === 0) return null;
	return (
		<span className={cn("ms-1.5 inline-flex items-center gap-1 align-middle", className)}>
			{tags.slice(0, 2).map((tag) =>
				onSelect ? (
					<button
						key={tag}
						type="button"
						dir="auto"
						aria-label={t`Filter by ${tag}`}
						onClick={(event) => {
							// The row (and board card) opens on click; filtering is its own action.
							event.stopPropagation();
							onSelect(tag);
						}}
						className="touch-target relative max-w-24 truncate rounded-sm bg-sunken px-1.5 text-xs leading-4 text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink"
					>
						{tag}
					</button>
				) : (
					<span
						key={tag}
						dir="auto"
						className="max-w-24 truncate rounded-sm bg-sunken px-1.5 text-xs leading-4 text-ink-2"
					>
						{tag}
					</span>
				),
			)}
			{tags.length > 2 && <span className="text-xs leading-4 text-ink-3">+{tags.length - 2}</span>}
		</span>
	);
}
