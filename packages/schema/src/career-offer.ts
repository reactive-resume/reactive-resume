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
