/**
 * A title for a new section that no other section already shows: "Projects", else "Projects 2", "Projects 3"…
 * Compared without case or surrounding spaces.
 */
export function nextFreeSectionTitle(base: string, taken: Iterable<string>): string {
	const used = new Set([...taken].map((title) => title.trim().toLocaleLowerCase()));
	if (!used.has(base.trim().toLocaleLowerCase())) return base;
	for (let number = 2; ; number++) {
		const candidate = `${base} ${number}`;
		if (!used.has(candidate.toLocaleLowerCase())) return candidate;
	}
}
