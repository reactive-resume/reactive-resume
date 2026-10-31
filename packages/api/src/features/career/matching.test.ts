import { describe, expect, it } from "vite-plus/test";
import { matchOpportunity, matchPosting } from "./matching";

const phrases = ["Senior Product Manager", "Product Lead — Onboarding", "Berlin", "Remote within Europe"];

describe("matchOpportunity", () => {
	it("matches a preference only when all its words appear, in the user's own wording", () => {
		const posting =
			"Senior Product Manager – Mosaic Cloud. Lead onboarding and product-led growth. Berlin hybrid; customer discovery.";
		expect(matchOpportunity(posting, phrases).matches).toEqual([
			"Senior Product Manager",
			"Product Lead — Onboarding",
			"Berlin",
		]);
		expect(matchOpportunity("Remote roles in Europe", phrases).matches).toEqual(["Remote within Europe"]);
	});

	it.each([
		["Remote work within Europe, salary €90,000–€105,000", []],
		["Hybrid, 3 days on-site. 95k base", []],
		["Own the new-customer journey", ["salary", "office"]],
		["Fully remote team", ["salary"]],
		["Salary 80 000 EUR", ["office"]],
	])("names what %j leaves out", (posting, unknowns) => {
		expect(matchOpportunity(posting, []).unknowns).toEqual(unknowns);
	});
});

it("keeps user counts, office software and remote APIs unknown; ignores search snippets as evidence", () => {
	expect(
		matchPosting(
			{
				role: "Product engineer",
				location: "",
				snippet: "Remote, salary $150000",
				description: "Support 10,000 users and remote APIs with office software.",
			},
			{ targetRoles: ["Senior product engineer"], locations: ["Berlin"] },
		),
	).toEqual({ matches: [], keywordOverlap: ["product", "engineer"], unknowns: ["salary", "office"] });
});

it.each(["SEK", "NOK", "DKK", "PLN", "CAD", "AUD", "INR", "JPY"])(
	"recognizes explicit %s employee pay with a number",
	(currency) => {
		for (const text of [
			`Salary: 80000 ${currency} per year.`,
			`Base pay: 120000 ${currency} per year.`,
			`Compensation: 100000 ${currency} annually.`,
			`Base pay: ${currency} 120000 per year.`,
		])
			expect(matchOpportunity(text, []).unknowns).not.toContain("salary");
		for (const text of [
			`Salary paid in ${currency}.`,
			`Support 100000 ${currency} customers.`,
			`Product budget: 100000 ${currency} per year.`,
			`Our salary tools support 100000 ${currency} customers.`,
		])
			expect(matchOpportunity(text, []).unknowns).toContain("salary");
	},
);

it.each([
	"Build remote work tools for customers.",
	"We build remote work tools for customers.",
	"Tools for fully remote teams.",
	"Remote work tools for customers.",
	"Remote APIs and office software.",
])("does not infer employee workplace from product copy: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).toContain("office");
});

it.each(
	["SEK", "NOK", "DKK", "PLN", "CAD", "AUD", "INR", "JPY"].flatMap((currency) => [
		`Salary range: 80000–100000 ${currency} per year.`,
		`Salary range: ${currency} 80000–100000 per year.`,
		`Annual salary range: 80,000—100,000 ${currency}.`,
		`Compensation range: 80 000 - 100 000 ${currency} annually.`,
		`Pay range: 80000 to 100000 ${currency} per year.`,
		`Salary range: ${currency} 80000–${currency} 100000 per year.`,
	]),
)("recognizes an explicit employee salary range: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).not.toContain("salary");
});

it.each([
	"Salary range: negotiable, paid in SEK.",
	"Salary range tools help 80000–100000 SEK customers.",
	"Product budget: 80000–100000 CAD per year.",
	"Compensation software serves 80000–100000 AUD users.",
])("keeps incomplete or product ranges unknown: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).toContain("salary");
});

it.each([
	"You can work remotely.",
	"We work remote.",
	"This role is fully remote.",
	"Hybrid working arrangement.",
	"Remote work within Europe.",
])("accepts employee arrangements: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).not.toContain("office");
});

it.each([
	"The base salary range for this position is $120,000 - $150,000 per year.",
	"The pay range for this role is $80,000 - $100,000.",
	"Expected salary range is between $100,000 and $130,000 annually.",
	"Salary range for this role: $80,000-$100,000",
	"Salary: 80,000 € per year.",
	"Pay: $45 - $55 per hour.",
	"$120,000 – $150,000 a year.",
	"Salary: 80000–100000 SEK per year.",
])("detects common explicit employee pay statements: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).not.toContain("salary");
});

it.each([
	"Salary software serves 80000–100000 AUD users.",
	"Our salary tools support $100,000 of customer budgets.",
	"Compensation: 401k matching and health benefits.",
	"Compensation: $10M ARR team.",
	"We manage a $120,000–$150,000 product budget per year.",
	"A salary guide helps teams. Budget: $150,000.",
	"Funding $50M, 100000 users and a $99 product price.",
])("keeps product, benefits and budget figures unknown: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).toContain("salary");
});

it.each([
	"Location: Remote (US).",
	"This is a remote position.",
	"The position is fully remote.",
	"Workplace type: Hybrid.",
	"Remote.",
])("recognizes explicit workplace statements: %s", (text) => {
	expect(matchOpportunity(text, []).unknowns).not.toContain("office");
});
