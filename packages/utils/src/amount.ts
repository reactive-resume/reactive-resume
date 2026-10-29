/** Parse a complete nonnegative amount. Invalid notation must never silently change a saved requirement. */
export function parseAmount(input: string, locale: string): number | null | undefined {
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
	if (!/^\d+$/.test(ungrouped) || (fraction !== undefined && !/^\d{1,2}$/.test(fraction))) return undefined;
	if (group && whole.includes(group)) {
		const expected = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(ungrouped));
		let normalized = expected;
		for (let digit = 0; digit <= 9; digit++) normalized = normalized.replaceAll(digits.format(digit), String(digit));
		if (whole !== normalized) return undefined;
	}
	const value = Number(`${ungrouped}.${fraction ?? "0"}`);
	return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
}
