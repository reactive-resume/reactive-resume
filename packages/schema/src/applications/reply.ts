/** Outermost balanced draft fields, including nested and localized labels; never blocks copying. */
export function replyPlaceholders(text: string): string[] {
	const opens: number[] = [];
	const spans: [number, number][] = [];
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === "\n" || char === "\r") opens.length = 0;
		else if (char === "[") opens.push(index);
		else if (char === "]") {
			const start = opens.pop();
			if (start === undefined || index === start + 1) continue;
			while ((spans.at(-1)?.[0] ?? -1) > start) spans.pop();
			spans.push([start, index + 1]);
		}
	}
	return [...new Set(spans.map(([start, end]) => text.slice(start, end)))];
}
