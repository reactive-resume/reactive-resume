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
	if (value === 0 && /[1-9]/.test(`${ungrouped}${fraction ?? ""}`)) return undefined;
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

// Shared CLDR codes keep browser and Hermes choices identical without Intl.supportedValuesOf.
const currencyCodes = (
	"AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD " +
	"CAD CDF CHF CLP CNY COP CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP " +
	"GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW " +
	"KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD " +
	"NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP " +
	"SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND " +
	"VUV WST XAF XCD XCG XDR XOF XPF XSU YER ZAR ZMW ZWG ZWL"
).split(" ");

/** Codes disambiguate shared symbols; a previously saved code remains selectable. */
export function getCurrencyOptions(locale: string, current = "") {
	const codes =
		/^[A-Z]{3}$/.test(current) && !currencyCodes.includes(current) ? [...currencyCodes, current] : currencyCodes;
	return codes.map((value) => {
		const symbol = new Intl.NumberFormat(locale, { style: "currency", currency: value })
			.formatToParts(0)
			.find((part) => part.type === "currency")?.value;
		return { value, label: symbol && symbol !== value ? `${value} · ${symbol}` : value };
	});
}
