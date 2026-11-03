function parseLocalizedNumber(input: string, locale: string, maximumFractionDigits: number): number | null | undefined {
	const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
	const parts = number.formatToParts(12345.6);
	const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
	const group = parts.find((part) => part.type === "group")?.value;
	const digits = new Intl.NumberFormat(locale, { useGrouping: false });
	let text = input.trim().replace(/[\u061c\u200e\u200f]/g, "");
	if (!text) return null;
	for (let digit = 0; digit <= 9; digit++) text = text.replaceAll(digits.format(digit), String(digit));
	const pieces = text.split(decimal);
	if (pieces.length > 2) return undefined;
	const [whole = "", fraction] = pieces;
	const ungrouped = group ? whole.replaceAll(group, "") : whole;
	if (
		!/^\d+$/.test(ungrouped) ||
		(fraction !== undefined && (!/^\d+$/.test(fraction) || fraction.length > maximumFractionDigits))
	)
		return undefined;
	if (group && whole.includes(group)) {
		const expected = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(ungrouped));
		let normalized = expected;
		for (let digit = 0; digit <= 9; digit++) normalized = normalized.replaceAll(digits.format(digit), String(digit));
		if (whole !== normalized) return undefined;
	}
	const value = Number(`${ungrouped}.${fraction ?? "0"}`);
	return Number.isFinite(value) ? value : undefined;
}

/** Complete, finite, nonnegative decimal; percentages retain their stored precision. */
export function parseDecimal(input: string, locale: string): number | null | undefined {
	return parseLocalizedNumber(input, locale, Number.POSITIVE_INFINITY);
}

/** Money retains its two-decimal and safe-integer bounds. */
export function parseAmount(input: string, locale: string): number | null | undefined {
	const value = parseLocalizedNumber(input, locale, 2);
	return typeof value === "number" && value > Number.MAX_SAFE_INTEGER ? undefined : value;
}
