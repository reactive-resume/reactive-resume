import type { OfferTerms } from "./career";
import { parseAmount, parseDecimal } from "@reactive-resume/utils/amount";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { careerOfferInputSchema } from "./career";

type OfferEntry = {
	applicationId: string;
	terms: OfferTerms;
	amounts: Record<"base" | "variable" | "learning", string>;
	date: string;
	time: string;
	locale: string;
	/** Null until the account timezone is available. Never guess from the device. */
	timeZone: string | null;
};

/** Blank optional fields are unknown; invalid entered values must not reach schema defaults. */
export function parseOfferEntry({ applicationId, terms, amounts, date, time, locale, timeZone }: OfferEntry) {
	const base = parseAmount(amounts.base, locale);
	const percentage = amounts.variable.trim().endsWith("%");
	const variable = percentage
		? parseDecimal(amounts.variable.trim().slice(0, -1).trim(), locale)
		: parseAmount(amounts.variable, locale);
	const invalidVariable = variable === undefined || (percentage && variable === null);
	const learning = parseAmount(amounts.learning, locale);
	const deadline = date && timeZone ? fromZonedDateTime(date, time, timeZone) : null;
	const deadlineError = !date ? null : !timeZone ? "timezone" : !deadline ? "wallTime" : null;
	return {
		amountErrors: { base: base === undefined, variable: invalidVariable, learning: learning === undefined },
		deadlineError,
		payload: careerOfferInputSchema.safeParse({
			...terms,
			applicationId,
			base: base === undefined ? Number.NaN : base,
			variable: invalidVariable ? Number.NaN : percentage ? null : variable,
			variablePercent: percentage ? variable : null,
			learning: learning === undefined ? Number.NaN : learning,
			respondBy: deadlineError ? "" : (deadline?.toISOString() ?? null),
		}),
	};
}

type OfferVersion = { id: string; applicationId: string | null };
/** Explicit versions stay explicit; remembered selections follow each application's newest saved terms. */
export function selectOfferPair<T extends OfferVersion>(
	offers: T[],
	requested: { a?: string | undefined; b?: string | undefined },
	remembered: { a?: string | undefined; b?: string | undefined } = {},
) {
	const find = (id: string | undefined) => offers.find((offer) => offer.id === id);
	const newest = (id: string | undefined) => {
		const old = find(id);
		return old?.applicationId ? offers.find((offer) => offer.applicationId === old.applicationId) : old;
	};
	const a = find(requested.a) ?? newest(remembered.a) ?? offers[0];
	const candidate = find(requested.b) ?? newest(remembered.b);
	const b =
		candidate && candidate.id !== a?.id
			? candidate
			: offers.find((offer) => offer.id !== a?.id && offer.applicationId !== a?.applicationId);
	return { a: a?.id, b: b?.id };
}

/** Offer entry prioritizes current offers and excludes applications closed as not selected. */
export function offerApplications<T extends { status: string; closedReason: string | null }>(applications: T[]) {
	return applications
		.filter((row) => !(row.status === "closed" && row.closedReason === "not-selected"))
		.sort((a, b) => Number(b.status === "offer") - Number(a.status === "offer"));
}

type SavedOffer = { createdAt: Date | string; data: { kind: string; currency?: string } };

/**
 * The currency of the newest offer saved, so the next one starts in it and the two compare. Empty when there's none:
 * a guessed currency would read as one the person chose.
 */
export function previousOfferCurrency(items: readonly SavedOffer[] | undefined): string {
	let newest: SavedOffer | undefined;
	for (const item of items ?? []) {
		if (item.data.kind !== "offer" || !item.data.currency) continue;
		if (!newest || new Date(item.createdAt).getTime() > new Date(newest.createdAt).getTime()) newest = item;
	}
	return newest?.data.currency ?? "";
}

export type OfferTermKey = "base" | "variable" | "equity" | "startDate" | "respondBy";

/** The extracted terms a review must show, in reading order, omitting ones the employer didn't state. */
export function offerTermKeys(terms: Pick<OfferTerms, OfferTermKey | "variablePercent">): OfferTermKey[] {
	const known: Record<OfferTermKey, boolean> = {
		base: terms.base !== null,
		variable: terms.variable !== null || terms.variablePercent != null,
		equity: terms.equity.trim() !== "",
		startDate: terms.startDate !== null,
		respondBy: terms.respondBy !== null,
	};
	return (["base", "variable", "equity", "startDate", "respondBy"] as const).filter((key) => known[key]);
}

const KNOWN_CURRENCIES: ReadonlySet<string> | null = (() => {
	try {
		return typeof Intl.supportedValuesOf === "function" ? new Set(Intl.supportedValuesOf("currency")) : null;
	} catch {
		return null;
	}
})();

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
	"€": "EUR",
	"£": "GBP",
	"¥": "JPY",
	"₹": "INR",
	"₩": "KRW",
	"₺": "TRY",
	zł: "PLN",
	US$: "USD",
	A$: "AUD",
	C$: "CAD",
	$: "USD",
};

/**
 * What the job's own salary line says, to start an offer from: its currency (an ISO code, or a symbol such as € or £),
 * the lower end of the range as the base, read as a whole amount ("€165,000 – €190,000", "$120k–140k", "$120–140k"),
 * and its pay period ("/hour", "per month"; a year when it names none). Each is null when the line doesn't say; the
 * person edits them before saving.
 */
export function offerHintFromSalary(salary: string | null | undefined): {
	currency: string | null;
	base: number | null;
	period: "hour" | "month" | "year" | null;
} {
	const text = (salary ?? "").trim();
	if (!text) return { currency: null, base: null, period: null };
	// A three-letter code counts only beside an amount ("GBP 85k", "85,000 EUR") and, where the runtime lists them, when it
	// is a real ISO 4217 code: "OTE $120k" is in dollars.
	const codes = [...text.matchAll(/\b([A-Z]{3})\s*\d|\d\s*(?:k|m|thousand|million)?\s*([A-Z]{3})\b/gi)]
		.map((match) => match[1] ?? match[2] ?? "")
		.filter((value) => /^[A-Z]{3}$/.test(value) && (!KNOWN_CURRENCIES || KNOWN_CURRENCIES.has(value)));
	const code = codes[0] ?? null;
	const symbol = Object.keys(CURRENCY_SYMBOLS).find((key) => text.includes(key));
	const currency = code ?? (symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null);
	const period = /(?:\/|\bper\s+|\ban?\s+)(?:h|hr|hour)\b|\bhourly\b/i.test(text)
		? "hour"
		: /(?:\/|\bper\s+|\ba\s+)(?:mo|month)\b|\bmonthly\b/i.test(text)
			? "month"
			: /(?:\/|\bper\s+|\ba\s+)(?:yr|year|annum)\b|\bannual(?:ly)?\b|\byearly\b/i.test(text)
				? "year"
				: null;
	// Each amount (or range, whose unit may follow only its upper end: "120–140k"). The first one written with a
	// currency or a unit wins, so "2026 compensation: $120,000" reads 120,000, not the year.
	const amounts = [
		...text.matchAll(
			/(\d(?:[\d.,]*\d)?)\s*(k|m|thousand|million)?(?![a-z])(?:\s*(?:[-–—]|to)\s*\D{0,4}?\d(?:[\d.,]*\d)?\s*(k|m|thousand|million)?(?![a-z]))?/gi,
		),
	];
	const anchored = (match: RegExpExecArray | RegExpMatchArray) => {
		if (match[2] || match[3]) return true;
		const index = match.index ?? 0;
		const before = text.slice(Math.max(0, index - 4), index);
		const after = text.slice(index + match[0].length);
		return /(?:[$€£¥₹₩₺]|zł|\b[A-Z]{3})\s*$/.test(before) || /^\s*[A-Z]{3}\b/.test(after);
	};
	const first = amounts.find(anchored) ?? amounts[0];
	if (!first?.[1]) return { currency, base: null, period };
	const digits = first[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
	const number = Number.parseFloat(digits);
	const unit = (first[2] ?? first[3] ?? "").toLowerCase();
	const scale = unit === "k" || unit === "thousand" ? 1_000 : unit === "m" || unit === "million" ? 1_000_000 : 1;
	const base = Number.isFinite(number) ? Math.round(number * scale) : null;
	return { currency, base: base && base > 0 ? base : null, period };
}

/** Resolve only explicit numeric bonuses; old free-text conditions remain uninterpreted. */
export function bonusAmount(terms: Pick<OfferTerms, "base" | "variable" | "variablePercent">) {
	if (terms.variablePercent == null) return terms.variable;
	if (terms.base === null) return null;
	const amount = (terms.base / 100) * terms.variablePercent;
	return Number.isFinite(amount) ? amount : null;
}

export function bonusEntry(terms: Pick<OfferTerms, "variable" | "variablePercent">, locale: string) {
	return terms.variablePercent != null
		? `${new Intl.NumberFormat(locale, { useGrouping: false, maximumSignificantDigits: 21 }).format(terms.variablePercent)}%`
		: terms.variable === null
			? ""
			: String(terms.variable);
}

/** Month/year arithmetic needs no guessed working hours. It never changes comparison eligibility. */
export function annualBaseHint(terms: OfferTerms, other: OfferTerms) {
	if (terms.currency !== other.currency || terms.period !== "month" || other.period !== "year" || terms.base === null)
		return null;
	const amount = terms.base * 12;
	return Number.isFinite(amount) ? amount : null;
}
