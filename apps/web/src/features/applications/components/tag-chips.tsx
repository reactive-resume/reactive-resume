/** Up to two of an application's tags, as small chips beside its company; the rest are counted. */
export function TagChips({ tags }: { tags: readonly string[] }) {
	if (tags.length === 0) return null;
	return (
		<span className="ms-1.5 inline-flex items-center gap-1 align-middle">
			{tags.slice(0, 2).map((tag) => (
				<span
					key={tag}
					dir="auto"
					className="max-w-24 truncate rounded-sm bg-sunken px-1.5 text-xs leading-4 text-ink-2"
				>
					{tag}
				</span>
			))}
			{tags.length > 2 && <span className="text-xs leading-4 text-ink-3">+{tags.length - 2}</span>}
		</span>
	);
}
