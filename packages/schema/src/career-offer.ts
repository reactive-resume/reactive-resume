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
