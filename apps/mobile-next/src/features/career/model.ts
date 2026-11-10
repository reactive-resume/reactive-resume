import type { CareerSource } from "@reactive-resume/schema/career";
import type { OfferTerms } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";
export function betterBase(a: OfferTerms, b: OfferTerms) {
	return a.currency === b.currency && a.period === b.period && a.base !== null && b.base !== null && a.base > b.base;
}
export function betterLeave(a: OfferTerms, b: OfferTerms) {
	const x = /^(\d+) days$/.exec(a.leave);
	const y = /^(\d+) days$/.exec(b.leave);
	return !!x && !!y && Number(x[1]) > Number(y[1]);
}
export function priorityItems(value: string) {
	return value
		.split(/,?\s+then\s+|,/i)
		.map((v) => v.trim())
		.filter(Boolean);
}
export function movePriority<T>(items: readonly T[], from: number, to: number) {
	if (from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
	const next = [...items];
	const [item] = next.splice(from, 1);
	if (item !== undefined) next.splice(to, 0, item);
	return next;
}

/** The quiet line under a fact: where it came from. */
export function factSourceLine(kind: CareerSource["kind"]) {
	switch (kind) {
		case "resume":
		case "resume-version":
			return t`From your resume`;
		case "letter":
		case "letter-version":
			return t`From your cover letter`;
		case "user-message":
			return t`You told the coach`;
		case "attachment":
			return t`From a document you attached`;
		case "debrief":
			return t`From a debrief`;
		default:
			return t`Added by you`;
	}
}
