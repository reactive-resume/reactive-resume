/** A run of words in a word-level comparison: kept in both texts, only in the old one, or only in the new one. */
export type WordDiffSegment = { kind: "same" | "removed" | "added"; text: string };

// Each word keeps the whitespace after it, so joined segments read back as the original text.
const words = (text: string) => text.match(/[^\s]+\s*|\s+/gu) ?? [];

/**
 * Compares two texts word by word (longest common subsequence). Returns null when they share too little for a
 * word-level view to help (a rewrite), so the caller shows old and new whole.
 */
export function wordDiff(before: string, after: string, { minShared = 0.4 } = {}): WordDiffSegment[] | null {
	const a = words(before).map((token) => ({ token, key: token.trim() }));
	const b = words(after).map((token) => ({ token, key: token.trim() }));
	if (a.length === 0 || b.length === 0 || a.length * b.length > 250_000) return null;

	// lengths[i * width + j]: the longest common run of a[i..] and b[j..].
	const width = b.length + 1;
	const lengths = new Uint16Array((a.length + 1) * width);
	const at = (i: number, j: number) => lengths[i * width + j] ?? 0;
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			lengths[i * width + j] = a[i]?.key === b[j]?.key ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));

	if (at(0, 0) / Math.max(a.length, b.length) < minShared) return null;

	const segments: WordDiffSegment[] = [];
	const push = (kind: WordDiffSegment["kind"], text = "") => {
		const last = segments.at(-1);
		if (last?.kind === kind) last.text += text;
		else segments.push({ kind, text });
	};
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i]?.key === b[j]?.key) {
			// The new text's spacing wins for a kept word.
			push("same", b[j]?.token);
			i++;
			j++;
		} else if (at(i + 1, j) >= at(i, j + 1)) push("removed", a[i++]?.token);
		else push("added", b[j++]?.token);
	}
	while (i < a.length) push("removed", a[i++]?.token);
	while (j < b.length) push("added", b[j++]?.token);
	return segments;
}
