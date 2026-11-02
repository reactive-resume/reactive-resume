import type { OfferTerms } from "./career";
import { parseAmount } from "@reactive-resume/utils/amount";
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
	const variable = parseAmount(amounts.variable, locale);
	const learning = parseAmount(amounts.learning, locale);
	const deadline = date && timeZone ? fromZonedDateTime(date, time, timeZone) : null;
	const deadlineError = !date ? null : !timeZone ? "timezone" : !deadline ? "wallTime" : null;
	return {
		amountErrors: { base: base === undefined, variable: variable === undefined, learning: learning === undefined },
		deadlineError,
		payload: careerOfferInputSchema.safeParse({
			...terms,
			applicationId,
			base: base === undefined ? Number.NaN : base,
			variable: variable === undefined ? Number.NaN : variable,
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
export function offerTermKeys(terms: Pick<OfferTerms, OfferTermKey>): OfferTermKey[] {
	const known: Record<OfferTermKey, boolean> = {
		base: terms.base !== null,
		variable: terms.variable !== null,
		equity: terms.equity.trim() !== "",
		startDate: terms.startDate !== null,
		respondBy: terms.respondBy !== null,
	};
	return (["base", "variable", "equity", "startDate", "respondBy"] as const).filter((key) => known[key]);
}

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
	const code = /\b([A-Z]{3})\b/.exec(text)?.[1] ?? null;
	const symbol = Object.keys(CURRENCY_SYMBOLS).find((key) => text.includes(key));
	const currency = code ?? (symbol ? (CURRENCY_SYMBOLS[symbol] ?? null) : null);
	const period = /(?:\/|\bper\s+|\ban?\s+)(?:h|hr|hour)\b|\bhourly\b/i.test(text)
		? "hour"
		: /(?:\/|\bper\s+|\ba\s+)(?:mo|month)\b|\bmonthly\b/i.test(text)
			? "month"
			: /(?:\/|\bper\s+|\ba\s+)(?:yr|year|annum)\b|\bannual(?:ly)?\b|\byearly\b/i.test(text)
				? "year"
				: null;
	// The first amount, and the unit after it or, in "120–140k", after the range's upper end.
	const range = /(\d(?:[\d.,]*\d)?)\s*([kKmM])?\s*(?:[-–—]|to)\s*\D{0,4}\d(?:[\d.,]*\d)?\s*([kKmM])?/.exec(text);
	const first = range ?? /(\d(?:[\d.,]*\d)?)\s*([kKmM])?(?![a-z])/i.exec(text);
	if (!first?.[1]) return { currency, base: null, period };
	const digits = first[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".");
	const number = Number.parseFloat(digits);
	const unit = first[2] ?? (range ? range[3] : undefined) ?? "";
	const scale = /k/i.test(unit) ? 1_000 : /m/i.test(unit) ? 1_000_000 : 1;
	const base = Number.isFinite(number) ? Math.round(number * scale) : null;
	return { currency, base: base && base > 0 ? base : null, period };
}
