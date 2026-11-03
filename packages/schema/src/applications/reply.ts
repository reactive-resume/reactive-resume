/** Outermost balanced draft fields, including nested and localized labels; never blocks copying. */
export function replyPlaceholders(text: string): string[] {
	const fields = new Set<string>();
	let depth = 0;
	let start = 0;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "\n" || char === "\r") depth = 0;
		else if (char === "[") {
			if (depth === 0) start = index;
			depth++;
		} else if (char === "]" && depth > 0) {
			depth--;
			if (depth === 0 && index > start + 1) fields.add(text.slice(start, index + 1));
		}
	}
	return [...fields];
}
