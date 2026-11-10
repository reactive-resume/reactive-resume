import type { CareerProfileData, OfferTerms } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
import { bonusAmount } from "@reactive-resume/schema/career-offer";

type Pay = Pick<OfferTerms, "currency" | "period">;

/** Money is only compared in the same currency and pay period: anything else needs a guessed rate or hours. */
export const sameTerms = (a: Pay, b: Pay) => a.currency === b.currency && a.period === b.period;

/** How much more `a` pays than `b` (negative when less), or null when it can't be told honestly. */
export function moneyDifference(a: OfferTerms, b: OfferTerms, key: "base" | "variable" | "learning") {
	const x = key === "variable" ? bonusAmount(a) : a[key];
	const y = key === "variable" ? bonusAmount(b) : b[key];
	if (x === null || y === null || !sameTerms(a, b)) return null;
	return x - y;
}

/** Whether the base clears the Preferences minimum; null when either is unknown or they're in different terms. */
export function meetsMinimum(offer: OfferTerms, minBase: CareerProfileData["minBase"]) {
	if (offer.base === null || minBase.amount === null || !sameTerms(offer, minBase)) return null;
	return offer.base >= minBase.amount;
}

export const formatMoney = (locale: string, currency: string, amount: number) =>
	new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

/** A preferred place the offer's location names (or is named by), ignoring case. */
export const matchingPlace = (location: string, places: string[]) => {
	const where = location.toLocaleLowerCase();
	return places.find((place) => {
		const wanted = place.toLocaleLowerCase();
		return where.includes(wanted) || wanted.includes(where);
	});
};

/** Percentage bonuses keep their entered rate, even when the base is unknown. */
export function formatBonus(locale: string, terms: OfferTerms) {
	if (terms.variablePercent == null)
		return terms.variable === null ? null : formatMoney(locale, terms.currency, terms.variable);
	const percent = new Intl.NumberFormat(locale, { style: "percent", maximumSignificantDigits: 21 }).format(
		terms.variablePercent / 100,
	);
	const amount = bonusAmount(terms);
	const value = amount === null ? null : formatMoney(locale, terms.currency, amount);
	return value === null ? t`${percent} of base` : t`${percent} of base (${value})`;
}
