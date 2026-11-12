import { offerTermsSchema } from "@reactive-resume/schema/career";
import { betterBase, betterLeave, movePriority, priorityItems } from "./model";
const offer = (values: Record<string, unknown>) =>
	offerTermsSchema.parse({ currency: "EUR", period: "year", base: null, variable: null, ...values });
it("never compares pay across currencies or pay periods, or against an unknown", () => {
	const a = offer({ base: 72000 });
	expect(betterBase(a, offer({ base: 68000 }))).toBe(true);
	expect(betterBase(a, offer({ base: 68000, currency: "USD" }))).toBe(false);
	expect(betterBase(a, offer({ base: 68000, period: "month" }))).toBe(false);
	expect(betterBase(a, offer({}))).toBe(false);
	expect(betterBase(a, a)).toBe(false);
});
it("compares only holidays stated in the same unit", () => {
	expect(betterLeave(offer({ leave: "25 days" }), offer({ leave: "23 days" }))).toBe(true);
	expect(betterLeave(offer({ leave: "25 days" }), offer({ leave: "6 weeks" }))).toBe(false);
	expect(betterLeave(offer({ leave: "25 days" }), offer({ leave: "" }))).toBe(false);
});
it("reorders priorities without losing any item", () => {
	const items = priorityItems("Pay, then remote, then holidays");
	expect(movePriority(items, 2, 0)).toEqual(["holidays", "Pay", "remote"]);
	expect(items).toEqual(["Pay", "remote", "holidays"]);
});
